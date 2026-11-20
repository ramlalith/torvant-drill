// Loads cards, rounds and stored card text, and builds the public view of a card.
// The public view never contains the answer (risky, risk type, why to deny).

import fs from "fs";
import path from "path";
import { StoredCardText } from "./card_text";
import { RiskLevel, risk_flags } from "./risk_rules";
import { Card } from "./types";

const LEVEL_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export const CARD_TEXT_PATH = path.resolve(process.cwd(), "data/card_text.json");

export interface CardTextFile {
  generated_at: string;
  model: string;
  cards: Record<string, StoredCardText>;
}

export interface PublicCard {
  id: string;
  task: string;
  command: string;
  level: RiskLevel;
  flags: string[];
  text: null | {
    what_it_does: string;
    touches: string[];
    reach: string;
    can_be_undone: string;
    fits_task: string;
    fits_task_why: string;
    raised_by_model: boolean;
    model: string;
  };
}

export function loadCards(): Card[] {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/cards.json"), "utf-8"));
}

export function loadRounds(): { roundA: { name: string; cardIds: string[] }; roundB: { name: string; cardIds: string[] } } {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/rounds.json"), "utf-8"));
}

let cachedText: { mtimeMs: number; data: CardTextFile | null } = { mtimeMs: -1, data: null };

export function loadCardText(): CardTextFile | null {
  try {
    const st = fs.statSync(CARD_TEXT_PATH);
    if (st.mtimeMs !== cachedText.mtimeMs) {
      cachedText = { mtimeMs: st.mtimeMs, data: JSON.parse(fs.readFileSync(CARD_TEXT_PATH, "utf-8")) };
    }
    return cachedText.data;
  } catch {
    return null;
  }
}

/** The card as the phone sees it before a decision: no answer fields. */
export function toPublicCard(card: Card, stored: StoredCardText | undefined): PublicCard {
  const rules = risk_flags(card.task, card.command);
  return {
    id: card.id,
    task: card.task,
    command: card.command,
    // Rules set the lowest level. Gemini can raise it, never lower it.
    // The shown level is the higher of today's rules and the stored level, so
    // a stored text written before a rule change can never show a lower level.
    level: stored && LEVEL_RANK[stored.risk_level] > LEVEL_RANK[rules.level] ? stored.risk_level : rules.level,
    flags: rules.flags,
    text: stored
      ? {
          what_it_does: stored.what_it_does,
          touches: stored.touches,
          reach: stored.reach,
          can_be_undone: stored.can_be_undone,
          fits_task: stored.fits_task,
          fits_task_why: stored.fits_task_why,
          raised_by_model: stored.raised_by_model,
          model: stored.model
        }
      : null
  };
}
