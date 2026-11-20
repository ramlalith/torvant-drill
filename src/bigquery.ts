import { BigQuery } from "@google-cloud/bigquery";
import { sinceSql, teamResultsSince } from "./results_since";

export interface DecisionRow {
  play_id: string;
  player_id: string;
  ts: string; // ISO 8601 string
  round: string;
  card_variant: string;
  queue_id: string;   // round letter: "A" or "B"
  position: number;   // 1-based card position within the round
  card_id: string;
  risky: boolean;
  risk_type: string | null;
  decision: string;
  seconds: number;
  reached: boolean;
}

export interface VariantStats {
  card_variant: string;
  variant_players: number;
  risky_reached: number;
  risky_caught: number;
  risky_caught_pct: number;
  normal_reached: number;
  normal_wrongly_blocked: number;
  normal_blocked_pct: number;
  median_seconds: number;
}

export interface RiskTypeStats {
  risk_type: string;
  total_reached: number;
  approved_count: number;
  approved_pct: number;
}

export interface TeamResults {
  total_players: number;
  total_decisions: number;
  is_small_sample: boolean;
  variants: VariantStats[];
  risk_types: RiskTypeStats[];
  cached_at: string;
}

const projectId = process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0405873744";
const datasetId = "torvant_drill";
// Set DECISIONS_TABLE to start a fresh, empty results table (for example before the hall plays).
const tableId = process.env.DECISIONS_TABLE || "decisions";

let bqClient: BigQuery | null = null;
function getBigQueryClient(): BigQuery {
  if (!bqClient) {
    bqClient = new BigQuery({ projectId });
  }
  return bqClient;
}

// In-memory queue for non-blocking writes and retries
const inMemoryQueue: DecisionRow[] = [];
let isFlushing = false;

/**
 * Enqueue a decision row in memory and asynchronously flush to BigQuery.
 * Never throws or blocks the caller.
 */
export function enqueueDecision(row: DecisionRow): void {
  inMemoryQueue.push(row);
  flushQueue().catch((err) => {
    console.warn("Background BigQuery flush failed, rows kept in memory:", err.message);
  });
}

/**
 * Attempt to flush queued rows to BigQuery.
 * If a write fails, rows remain in memory for subsequent retries.
 */
export async function flushQueue(): Promise<void> {
  if (isFlushing || inMemoryQueue.length === 0) return;
  isFlushing = true;

  try {
    const bq = getBigQueryClient();
    while (inMemoryQueue.length > 0) {
      const batch = inMemoryQueue.slice(0, 50);
      try {
        await bq.dataset(datasetId).table(tableId).insert(batch);
        // Remove successfully inserted batch
        inMemoryQueue.splice(0, batch.length);
      } catch (error) {
        console.warn("BigQuery insert error. Retaining batch in memory for retry:", error);
        break; // Stop current flush attempt; retry later
      }
    }
  } catch (initError) {
    console.warn("BigQuery client error during flush:", initError);
  } finally {
    isFlushing = false;
  }
}

// Background retry interval (every 10 seconds)
setInterval(() => {
  if (inMemoryQueue.length > 0) {
    flushQueue().catch(() => {});
  }
}, 10_000);

// In-memory cache for /team query results (cached for 30 seconds)
let cachedResults: TeamResults | null = null;
let lastCacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Run single aggregated query against BigQuery for /team results,
 * with a 30-second in-memory cache.
 */
export async function getTeamResults(): Promise<TeamResults> {
  const now = Date.now();
  if (cachedResults && now - lastCacheTimestamp < CACHE_TTL_MS) {
    return cachedResults;
  }

  const since = teamResultsSince();
  const query = `
    WITH base AS (
      SELECT * FROM \`${projectId}.${datasetId}.${tableId}\`
      ${since ? `WHERE ts >= ${sinceSql(since)}` : ""}
    ),
    summary AS (
      SELECT
        COUNT(DISTINCT player_id) AS total_players,
        COUNT(1) AS total_decisions
      FROM base
    ),
    variants AS (
      SELECT
        card_variant,
        COUNT(DISTINCT player_id) AS variant_players,
        COUNTIF(risky AND reached) AS risky_reached,
        COUNTIF(risky AND reached AND decision = 'denied') AS risky_caught,
        ROUND(COALESCE(SAFE_DIVIDE(COUNTIF(risky AND reached AND decision = 'denied') * 100.0, COUNTIF(risky AND reached)), 0.0), 1) AS risky_caught_pct,
        COUNTIF(NOT risky AND reached) AS normal_reached,
        COUNTIF(NOT risky AND reached AND decision = 'denied') AS normal_wrongly_blocked,
        ROUND(COALESCE(SAFE_DIVIDE(COUNTIF(NOT risky AND reached AND decision = 'denied') * 100.0, COUNTIF(NOT risky AND reached)), 0.0), 1) AS normal_blocked_pct,
        ROUND(COALESCE(APPROX_QUANTILES(IF(reached, seconds, NULL), 2)[OFFSET(1)], 0.0), 1) AS median_seconds
      FROM base
      GROUP BY card_variant
    ),
    risk_types AS (
      SELECT
        risk_type,
        COUNTIF(reached) AS total_reached,
        COUNTIF(reached AND decision = 'approved') AS approved_count,
        ROUND(COALESCE(SAFE_DIVIDE(COUNTIF(reached AND decision = 'approved') * 100.0, COUNTIF(reached)), 0.0), 1) AS approved_pct
      FROM base
      WHERE risky IS TRUE AND risk_type IS NOT NULL AND risk_type != ''
      GROUP BY risk_type
    )
    SELECT
      (SELECT AS STRUCT * FROM summary) AS summary,
      (SELECT ARRAY_AGG(v) FROM variants v) AS variants,
      (SELECT ARRAY_AGG(r) FROM risk_types r) AS risk_types
  `;

  try {
    const bq = getBigQueryClient();
    const [rows] = await bq.query({
      query,
      location: "asia-south1",
    });

    const row = rows[0] || {};
    const totalPlayers = parseInt(row.summary?.total_players || "0", 10);
    const totalDecisions = parseInt(row.summary?.total_decisions || "0", 10);

    const variants: VariantStats[] = (row.variants || []).map((v: any) => ({
      card_variant: v.card_variant || "plain",
      variant_players: parseInt(v.variant_players || "0", 10),
      risky_reached: parseInt(v.risky_reached || "0", 10),
      risky_caught: parseInt(v.risky_caught || "0", 10),
      risky_caught_pct: parseFloat(v.risky_caught_pct || "0.0"),
      normal_reached: parseInt(v.normal_reached || "0", 10),
      normal_wrongly_blocked: parseInt(v.normal_wrongly_blocked || "0", 10),
      normal_blocked_pct: parseFloat(v.normal_blocked_pct || "0.0"),
      median_seconds: parseFloat(v.median_seconds || "0.0")
    }));

    const riskTypes: RiskTypeStats[] = (row.risk_types || []).map((r: any) => ({
      risk_type: r.risk_type,
      total_reached: parseInt(r.total_reached || "0", 10),
      approved_count: parseInt(r.approved_count || "0", 10),
      approved_pct: parseFloat(r.approved_pct || "0.0")
    }));

    const result: TeamResults = {
      total_players: totalPlayers,
      total_decisions: totalDecisions,
      is_small_sample: totalPlayers < 30,
      variants,
      risk_types: riskTypes,
      cached_at: new Date().toISOString()
    };

    cachedResults = result;
    lastCacheTimestamp = Date.now();
    return result;
  } catch (err) {
    console.warn("Error querying BigQuery, returning fallback/cached state:", err);
    if (cachedResults) {
      return cachedResults;
    }
    return {
      total_players: 0,
      total_decisions: 0,
      is_small_sample: true,
      variants: [],
      risk_types: [],
      cached_at: new Date().toISOString()
    };
  }
}
