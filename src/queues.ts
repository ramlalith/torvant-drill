// Stored drill queues built by the queue-builder agent, and the hand written
// rounds A and B as the fallback. The play path only reads stored files.

import fs from "fs";
import path from "path";
import { StoredCardText } from "./card_text";
import { loadCards, loadCardText, loadRounds } from "./cards_store";
import { textForRequest } from "./request_text";
import { Card } from "./types";

const QUEUE_DIR = path.resolve(process.cwd(), "data/queues");

export interface StoredQueue {
  queue_id: string;
  session_id: string;
  model: string;
  created_at: string;
  cards: Array<Card & { risk_type?: string; source: string; source_id: string }>;
  trace: Array<Record<string, unknown>>;
  card_text: Record<string, StoredCardText>;
}

export interface RoundSource {
  key: string; // "roundA", "roundB" or a queue id
  name: string;
  cards: Card[];
  text: Record<string, StoredCardText | undefined>;
  queue?: StoredQueue;
}

/**
 * Card text for a queue card. Every queue reads the one shared text for that
 * task + command (data/request_text.json), so the same request always looks the
 * same. The queue's own copy is only a fallback until that file exists.
 */
export function queueCardText(q: StoredQueue, card: { id: string; task: string; command: string }): StoredCardText | undefined {
  return textForRequest(card.task, card.command) || (q.card_text ? q.card_text[card.id] : undefined);
}

/** A queue is used only if it is complete: 8 cards, 2 risky, not first, card text for all. */
export function isUsableQueue(q: StoredQueue): boolean {
  return (
    Array.isArray(q.cards) &&
    q.cards.length === 8 &&
    q.cards.filter((c) => c.isRisky).length === 2 &&
    !q.cards[0].isRisky &&
    q.cards.every((c) => queueCardText(q, c))
  );
}

let cache: { stamp: string; queues: StoredQueue[] } = { stamp: "", queues: [] };

export function loadQueues(): StoredQueue[] {
  try {
    const files = fs.readdirSync(QUEUE_DIR).filter((f) => /^Q\d+\.json$/.test(f)).sort();
    const stamp = files.map((f) => `${f}:${fs.statSync(path.join(QUEUE_DIR, f)).mtimeMs}`).join("|");
    if (stamp !== cache.stamp) {
      const queues: StoredQueue[] = [];
      for (const f of files) {
        try {
          const q = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), "utf-8")) as StoredQueue;
          if (isUsableQueue(q)) queues.push(q);
          else console.warn(`Skipping incomplete queue ${f}`);
        } catch {
          console.warn(`Skipping unreadable queue ${f}`);
        }
      }
      cache = { stamp, queues };
    }
    return cache.queues;
  } catch {
    return [];
  }
}

export function handWrittenRound(key: "roundA" | "roundB"): RoundSource {
  const map = new Map(loadCards().map((c) => [c.id, c]));
  const r = loadRounds()[key];
  const text = loadCardText()?.cards || {};
  const cards = r.cardIds.map((id) => map.get(id)).filter((c): c is Card => Boolean(c));
  return { key, name: r.name, cards, text: Object.fromEntries(cards.map((c) => [c.id, text[c.id]])) };
}

function queueRound(q: StoredQueue): RoundSource {
  return {
    key: q.queue_id,
    name: `Queue ${q.queue_id}`,
    cards: q.cards,
    text: Object.fromEntries(q.cards.map((c) => [c.id, queueCardText(q, c)])),
    queue: q
  };
}

export function roundByKey(key: string): RoundSource | null {
  if (key === "roundA" || key === "roundB") return handWrittenRound(key);
  const q = loadQueues().find((x) => x.queue_id === key);
  return q ? queueRound(q) : null;
}

/**
 * Picks the two rounds for one play. Two different stored queues at random
 * when at least two exist, otherwise rounds A and B. DRILL_SOURCE=cards forces A and B.
 */
export function pickRounds(random: () => number = Math.random): { source: "queues" | "cards"; rounds: [RoundSource, RoundSource] } {
  const queues = process.env.DRILL_SOURCE === "cards" ? [] : loadQueues();
  if (queues.length >= 2) {
    const i = Math.floor(random() * queues.length);
    let j = Math.floor(random() * (queues.length - 1));
    if (j >= i) j++;
    return { source: "queues", rounds: [queueRound(queues[i]), queueRound(queues[j])] };
  }
  return { source: "cards", rounds: [handWrittenRound("roundA"), handWrittenRound("roundB")] };
}

/** Every card the drill can show, by id: hand written cards and all queue cards. */
export function findCard(id: string): { card: Card & { risk_type?: string }; text?: StoredCardText } | null {
  const base = loadCards().find((c) => c.id === id);
  if (base) return { card: base, text: loadCardText()?.cards[id] };
  for (const q of loadQueues()) {
    const c = q.cards.find((x) => x.id === id);
    if (c) return { card: c, text: queueCardText(q, c) };
  }
  return null;
}
