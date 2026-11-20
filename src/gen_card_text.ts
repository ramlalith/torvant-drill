// One-time generator: asks Gemini to write the Torvant card text for all 18 cards
// and stores it in data/card_text.json. The play screen reads this stored file,
// so the main path never waits on a live Gemini call.
//
// Run with: npm run gen:cards   (needs GEMINI_API_KEY in .env)

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import { generateCardText, pickNewestModel, StoredCardText } from "./card_text";
import { CARD_TEXT_PATH, CardTextFile, loadCards } from "./cards_store";
import { risk_flags } from "./risk_rules";

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Put it in .env");

  const model = process.env.GEMINI_PRO_MODEL || (await pickNewestModel(apiKey, "pro"));
  console.log(`Writing card text with ${model}`);

  const out: Record<string, StoredCardText> = {};
  const failed: string[] = [];
  for (const card of loadCards()) {
    const rules = risk_flags(card.task, card.command);
    try {
      const t = await generateCardText(apiKey, model, card.task, card.command, rules);
      out[card.id] = t;
      console.log(
        `${card.id.padEnd(4)} rules=${rules.level.padEnd(6)} final=${t.risk_level.padEnd(6)}` +
          `${t.raised_by_model ? " RAISED BY GEMINI" : ""} fits=${t.fits_task} | ${t.what_it_does}`
      );
    } catch (err) {
      failed.push(card.id);
      console.error(`${card.id} FAILED: ${(err as Error).message}`);
    }
  }

  if (failed.length) {
    console.error(`\n${failed.length} card(s) failed: ${failed.join(", ")}. Nothing written. Run again.`);
    process.exit(1);
  }
  const file: CardTextFile = { generated_at: new Date().toISOString(), model, cards: out };
  fs.writeFileSync(CARD_TEXT_PATH, JSON.stringify(file, null, 2) + "\n");
  console.log(`\nWrote ${Object.keys(out).length} cards to data/card_text.json`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
