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
