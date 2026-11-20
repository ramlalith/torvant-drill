// Two optional questions on the final summary. Pure checks; no names stored.

export const APPROVALS_PER_DAY = ["None", "1 to 10", "11 to 50", "More than 50"] as const;
export const READ_SHARE = ["All", "Most", "Some", "Almost none"] as const;

export interface AnswerRow {
  play_id: string;
  player_id: string;
  ts: string;
  approvals_per_day: string | null;
  read_share: string | null;
}

/** Returns a clean row, or null when the body is not a valid answer. */
export function toAnswerRow(body: unknown, now = new Date()): AnswerRow | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const playId = typeof b.play_id === "string" ? b.play_id.slice(0, 64) : "";
  const playerId = typeof b.player_id === "string" ? b.player_id.slice(0, 64) : "";
  if (!playId || !playerId) return null;
  const approvals = (APPROVALS_PER_DAY as readonly string[]).includes(b.approvals_per_day as string) ? (b.approvals_per_day as string) : null;
  const reads = (READ_SHARE as readonly string[]).includes(b.read_share as string) ? (b.read_share as string) : null;
  if (!approvals && !reads) return null;
  return { play_id: playId, player_id: playerId, ts: now.toISOString(), approvals_per_day: approvals, read_share: reads };
}

/** The one sentence at the top of the team results, worked out by code. */
export function teamSentence(variants: Array<{ risky_reached: number; risky_caught: number }>): string {
  const reached = variants.reduce((n, v) => n + (v.risky_reached || 0), 0);
  const approved = variants.reduce((n, v) => n + Math.max(0, (v.risky_reached || 0) - (v.risky_caught || 0)), 0);
  if (reached === 0) return "No risky requests have been answered yet.";
  return `Players approved ${approved} of ${reached} risky requests.`;
}

export interface AnswerCounts {
  total: number;
  approvals_per_day: Record<string, number>;
  read_share: Record<string, number>;
}

/** Turns rows of (question, answer, count) into counts per option, in the order asked. */
export function toAnswerCounts(rows: Array<{ q: string; a: string; n: number | string }>, total: number): AnswerCounts {
  const out: AnswerCounts = {
    total,
    approvals_per_day: Object.fromEntries(APPROVALS_PER_DAY.map((o) => [o, 0])),
    read_share: Object.fromEntries(READ_SHARE.map((o) => [o, 0]))
  };
  for (const r of rows) {
    const bucket = r.q === "approvals_per_day" ? out.approvals_per_day : r.q === "read_share" ? out.read_share : null;
    if (bucket && r.a in bucket) bucket[r.a] = Number(r.n) || 0;
  }
  return out;
}
