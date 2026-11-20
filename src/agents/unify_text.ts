// Run with: npm run cards:unify   (needs GEMINI_API_KEY in .env)
// Writes data/request_text.json (one text per unique request) and updates the
// cards of each stored queue when a normal card does not fit its task.
// Stored traces are left exactly as they are.

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { generateCardText } from "../card_text";
import { REQUEST_TEXT_PATH } from "../request_text";
import { risk_flags } from "../risk_rules";
import { SessionRequest } from "./drill_queue";
import { QueueLike, unifyRequests } from "./unify";

const DATA = path.resolve(process.cwd(), "data");

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Put it in .env");
  const model = process.env.GEMINI_PRO_MODEL || "gemini-4-argon";
  const skill = fs
    .readFileSync(path.resolve(process.cwd(), "skills/approval-card/SKILL.md"), "utf-8")
    .replace(/^---[\s\S]*?---\s*/, "");

  const qdir = path.join(DATA, "queues");
  const files = fs.readdirSync(qdir).filter((f) => /^Q\d+\.json$/.test(f)).sort();
  const raw: Record<string, string> = {};
  const queues: QueueLike[] = files.map((f) => {
    raw[f] = fs.readFileSync(path.join(qdir, f), "utf-8");
    return JSON.parse(raw[f]);
  });
  const sessions: Record<string, SessionRequest[]> = {};
  for (const q of queues) {
    if (sessions[q.session_id]) continue;
    sessions[q.session_id] = fs
      .readFileSync(path.join(DATA, "sessions", `${q.session_id}.jsonl`), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  console.log(`Writing one card text per unique request with ${model}...`);
  const result = await unifyRequests(queues, sessions, async (task, command) => {
    const rules = risk_flags(task, command);
    let t;
    try {
      t = await generateCardText(apiKey, model, task, command, rules, 120000, skill);
    } catch {
      t = await generateCardText(apiKey, model, task, command, rules, 120000, skill);
    }
    console.log(`  ${t.risk_level.padEnd(6)} fits=${t.fits_task.padEnd(3)} | ${command}`);
    return t;
  });

  fs.writeFileSync(
    REQUEST_TEXT_PATH,
    JSON.stringify({ generated_at: new Date().toISOString(), model, requests: result.requests }, null, 2) + "\n"
  );
  console.log(`\n${result.calls} unique requests written to data/request_text.json`);

  // Only the cards change. Every other field, including the trace, is kept as stored.
  result.queues.forEach((q, i) => {
    const original = JSON.parse(raw[files[i]]);
    if (JSON.stringify(original.cards) !== JSON.stringify(q.cards)) {
      original.cards = q.cards;
      fs.writeFileSync(path.join(qdir, files[i]), JSON.stringify(original, null, 2) + "\n");
    }
  });
  for (const c of result.changes) console.log(`CHANGED ${c}`);
  for (const p of result.problems) console.error(`PROBLEM ${p}`);
  if (result.problems.length) process.exit(1);
  console.log("No normal card has fits_task no. Every planted card is medium or high.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
