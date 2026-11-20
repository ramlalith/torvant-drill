// Runs both agents once and stores the results, so the play screen never waits
// on a model:
//   1. store-dev-agent works on the six tasks; every command it asks for stops
//      at ADK's approval gate and is recorded as a session.
//   2. queue-builder builds drill queues from that session (two planted risky
//      requests each), with a full trace.
//   3. The Torvant card text for every card is written with the approval-card skill.
//
// Run with: npm run agents            (needs GEMINI_API_KEY in .env)
//      or:  npm run agents -- --reuse-session

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { generateCardText, StoredCardText } from "../card_text";
import { risk_flags } from "../risk_rules";
import { buildQueue, BuiltQueue, loadSession, recordSession, saveSession, TraceLine } from "./agents";
import { RISK_PAIRS, usableRequests } from "./drill_queue";

const DATA = path.resolve(process.cwd(), "data");
const QUEUES = Number(process.env.QUEUES || 4);

function latestSessionId(): string | null {
  const dir = path.join(DATA, "sessions");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  return files.length ? files[files.length - 1].replace(/\.jsonl$/, "") : null;
}

function skillBody(name: string): string {
  const text = fs.readFileSync(path.resolve(process.cwd(), "skills", name, "SKILL.md"), "utf-8");
  return text.replace(/^---[\s\S]*?---\s*/, "");
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Put it in .env");
  const devModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const builderModel = process.env.GEMINI_PRO_MODEL || "gemini-4-argon";

  // 1. Session from the agent under test
  let sessionId = process.argv.includes("--reuse-session") ? latestSessionId() : null;
  if (sessionId) {
    console.log(`Reusing session ${sessionId}`);
  } else {
    sessionId = `session-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}`;
    const tasks = JSON.parse(fs.readFileSync(path.join(DATA, "tasks.json"), "utf-8"));
    console.log(`store-dev-agent (${devModel}) working on ${tasks.length} tasks...`);
    const requests = await recordSession(devModel, tasks);
    saveSession(sessionId, requests);
    console.log(`\nSession ${sessionId}: ${requests.length} approval requests`);
    for (const r of requests) console.log(`  ${r.request_id.padEnd(4)} ${r.task.padEnd(45).slice(0, 45)} | ${r.command}`);
  }
  const session = loadSession(sessionId);
  const usable = usableRequests(session);
  if (usable.length < 6) {
    throw new Error(`Only ${usable.length} usable requests in the session. Run again without --reuse-session.`);
  }

  // 2 and 3. Queues and their card text
  fs.mkdirSync(path.join(DATA, "queues"), { recursive: true });
  const existing = fs.readdirSync(path.join(DATA, "queues")).filter((f) => /^Q\d+\.json$/.test(f)).length;
  const cardSkill = skillBody("approval-card");
  let built = 0;
  for (let n = existing + 1; built < QUEUES && n <= existing + QUEUES * 2; n++) {
    const queueId = `Q${n}`;
    const pair = RISK_PAIRS[built % RISK_PAIRS.length];
    console.log(`\nqueue-builder (${builderModel}) building ${queueId} with ${pair.join(" + ")}...`);
    let q: BuiltQueue;
    try {
      q = await buildQueue(builderModel, queueId, sessionId, session, pair);
    } catch (err) {
      console.error(`  ${queueId} FAILED: ${(err as Error).message}`);
      continue;
    }
    for (const t of q.trace) console.log(`  ${String(t.step).padStart(2)} ${t.tool.padEnd(16)} ${t.result.slice(0, 90)}`);

    const cardText: Record<string, StoredCardText> = {};
    const textTrace: TraceLine = {
      step: q.trace.length + 1,
      kind: "skill",
      tool: "card_text",
      args: { cards: q.cards.length },
      result: "skill loaded: approval-card",
      model: builderModel,
      time: new Date().toISOString()
    };
    try {
      for (const c of q.cards) {
        const rules = risk_flags(c.task, c.command);
        try {
          cardText[c.id] = await generateCardText(apiKey, builderModel, c.task, c.command, rules, 120000, cardSkill);
        } catch {
          cardText[c.id] = await generateCardText(apiKey, builderModel, c.task, c.command, rules, 120000, cardSkill);
        }
      }
    } catch (err) {
      console.error(`  ${queueId} card text FAILED: ${(err as Error).message}`);
      continue;
    }
    const file = path.join(DATA, "queues", `${queueId}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...q, session_model: devModel, trace: [...q.trace, textTrace], card_text: cardText }, null, 2) + "\n");
    built++;
    console.log(`  ${queueId} saved: 8 cards`);
    for (const c of q.cards) {
      const t = cardText[c.id];
      console.log(
        `   ${c.isRisky ? "RISKY " + String(c.risk_type).padEnd(17) : "normal".padEnd(24)} ${t.risk_level.padEnd(6)} fits=${t.fits_task.padEnd(3)} | ${c.command}`
      );
    }
  }
  console.log(`\nBuilt ${built} of ${QUEUES} queues.`);
  if (built === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
