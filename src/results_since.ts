// No side effects here, so tests can import it without starting BigQuery timers.

/**
 * TEAM_RESULTS_SINCE (an ISO time, for example 2026-11-20T13:15:00Z): the team
 * results count only decisions at or after it. Nothing is deleted. Unset or not
 * a valid time means all decisions count.
 */
export function teamResultsSince(value = process.env.TEAM_RESULTS_SINCE): Date | null {
  if (!value || !value.trim()) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) {
    console.warn(`TEAM_RESULTS_SINCE "${value}" is not a valid time; counting all decisions.`);
    return null;
  }
  return d;
}

/**
 * SQL for the start time, as a BigQuery TIMESTAMP literal in the canonical
 * format ("YYYY-MM-DD HH:MM:SS.mmm+00:00"). Built only from a parsed Date, so
 * it holds digits and fixed symbols only, never raw text from the setting.
 */
export function sinceSql(since: Date): string {
  const s = since.toISOString().replace("T", " ").replace("Z", "+00:00");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/.test(s)) throw new Error("bad start time");
  return `TIMESTAMP('${s}')`;
}
