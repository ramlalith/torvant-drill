// Writes answers to BigQuery table torvant_drill.answers. Separate from the
// decisions table. The write never blocks the screen: rows wait in memory and
// are retried.

import { BigQuery } from "@google-cloud/bigquery";
import { AnswerCounts, AnswerRow, toAnswerCounts } from "./answers";
import { teamResultsSince } from "./results_since";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0405873744";
const datasetId = "torvant_drill";
export const ANSWERS_TABLE = "answers";

let client: BigQuery | null = null;
const bq = () => (client ||= new BigQuery({ projectId }));

const pending: AnswerRow[] = [];
const seenPlays = new Set<string>();
let flushing = false;

export function enqueueAnswer(row: AnswerRow): void {
  if (seenPlays.has(row.play_id)) return; // one answer per play
  seenPlays.add(row.play_id);
  pending.push(row);
  flushAnswers().catch(() => {});
}

async function flushAnswers(): Promise<void> {
  if (flushing || pending.length === 0) return;
  flushing = true;
  try {
    const batch = pending.slice(0, 50);
    await bq().dataset(datasetId).table(ANSWERS_TABLE).insert(batch);
    pending.splice(0, batch.length);
  } catch (err) {
    console.warn("Answers insert failed, kept in memory for retry:", (err as Error).message);
  } finally {
    flushing = false;
  }
}

setInterval(() => {
  if (pending.length) flushAnswers().catch(() => {});
}, 10_000).unref();

let cached: { at: number; value: AnswerCounts | null } = { at: 0, value: null };

/** Counts per option from the answers table, since TEAM_RESULTS_SINCE. Null if the table cannot be read. */
export async function getAnswerCounts(): Promise<AnswerCounts | null> {
  if (cached.value && Date.now() - cached.at < 30_000) return cached.value;
  const since = teamResultsSince();
  const where = since ? "AND ts >= @since" : "";
  const table = `\`${projectId}.${datasetId}.${ANSWERS_TABLE}\``;
  const query = `
    SELECT 'approvals_per_day' AS q, approvals_per_day AS a, COUNT(1) AS n FROM ${table}
      WHERE approvals_per_day IS NOT NULL ${where} GROUP BY a
    UNION ALL
    SELECT 'read_share' AS q, read_share AS a, COUNT(1) AS n FROM ${table}
      WHERE read_share IS NOT NULL ${where} GROUP BY a
    UNION ALL
    SELECT 'total' AS q, '' AS a, COUNT(1) AS n FROM ${table} WHERE TRUE ${where}`;
  try {
    const [rows] = await bq().query({
      query,
      location: "asia-south1",
      ...(since ? { params: { since: since.toISOString() }, types: { since: "TIMESTAMP" } } : {})
    });
    const total = Number((rows as any[]).find((r) => r.q === "total")?.n || 0);
    cached = { at: Date.now(), value: toAnswerCounts(rows as any[], total) };
    return cached.value;
  } catch (err) {
    console.warn("Answers query failed:", (err as Error).message);
    return null;
  }
}
