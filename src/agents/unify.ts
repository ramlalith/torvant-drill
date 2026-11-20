// Fixes 2 and 3: one card text per unique request, and no false alarm on a
// normal card. Pure logic; the Gemini call is passed in, so it can be tested.
// Only queue cards change. Stored traces are never touched.

import { StoredCardText } from "../card_text";
import { RequestText, requestKey } from "../request_text";
import { SessionRequest, usableRequests } from "./drill_queue";

export interface QueueLike {
  queue_id: string;
  session_id: string;
  cards: Array<{ id: string; task: string; command: string; isRisky: boolean; source: string; source_id: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

export type GenerateText = (task: string, command: string) => Promise<StoredCardText>;

export interface UnifyResult {
  requests: Record<string, RequestText>;
  queues: QueueLike[];
  changes: string[];
  problems: string[];
  calls: number;
}

export async function unifyRequests(
  queues: QueueLike[],
  sessions: Record<string, SessionRequest[]>,
  generate: GenerateText
): Promise<UnifyResult> {
  const requests: Record<string, RequestText> = {};
  let calls = 0;

  // Every request that is, or could become, a card: queue cards and usable session requests.
  const wanted: Array<{ task: string; command: string }> = [];
  for (const q of queues) for (const c of q.cards) wanted.push(c);
  for (const s of Object.values(sessions)) for (const r of usableRequests(s)) wanted.push(r);

  for (const r of wanted) {
    const key = requestKey(r.task, r.command);
    if (requests[key]) continue; // one call per unique task + command
    calls++;
    requests[key] = { ...(await generate(r.task, r.command)), task: r.task, command: r.command };
  }
  const textOf = (task: string, command: string) => requests[requestKey(task, command)];

  const changes: string[] = [];
  const problems: string[] = [];
  const out = queues.map((q) => ({ ...q, cards: q.cards.map((c) => ({ ...c })) }));

  for (const q of out) {
    const session = sessions[q.session_id] || [];
    for (const card of q.cards) {
      const t = textOf(card.task, card.command);
      if (card.isRisky) {
        if (t.risk_level === "low") problems.push(`${q.queue_id} ${card.id}: planted card is only low risk`);
        continue;
      }
      if (t.fits_task === "yes") continue;

      const inQueue = new Set(q.cards.map((c) => requestKey(c.task, c.command)));
      const candidates = usableRequests(session).filter((r) => {
        const rt = textOf(r.task, r.command);
        return !inQueue.has(requestKey(r.task, r.command)) && rt && rt.fits_task === "yes";
      });
      const pick = candidates.find((r) => r.task === card.task) || candidates[0];
      if (!pick) {
        problems.push(`${q.queue_id} ${card.id}: normal card does not fit its task and no replacement is left`);
        continue;
      }
      changes.push(`${q.queue_id} ${card.id}: replaced "${card.command}" (fits_task no) with ${pick.request_id} "${pick.command}"`);
      card.task = pick.task;
      card.command = pick.command;
      card.source_id = pick.request_id;
    }
  }
  return { requests, queues: out, changes, problems, calls };
}
