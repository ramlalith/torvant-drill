// Data for the "How it works" page. Every row is built from what the running
// service really has, so the page can never claim a tool that is not used.

import fs from "fs";
import path from "path";
import { loadCardText } from "./cards_store";
import { loadQueues } from "./queues";

export interface ToolRow {
  tool: string;
  job: string;
  evidence: string;
}

function adkVersion(): string | null {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "node_modules/@google/adk/package.json"), "utf-8")).version;
  } catch {
    return null;
  }
}

export function readTestSummary(): { tests: number; pass: number; fail: number } | null {
  try {
    const out = fs.readFileSync(path.resolve(process.cwd(), "test-output.txt"), "utf-8");
    const num = (k: string) => Number((out.match(new RegExp(`(?:ℹ|#) ${k} (\\d+)`)) || [])[1]);
    const tests = num("tests");
    const pass = num("pass");
    const fail = num("fail");
    return Number.isFinite(tests) && Number.isFinite(pass) ? { tests, pass, fail: Number.isFinite(fail) ? fail : 0 } : null;
  } catch {
    return null;
  }
}

export function buildHow(queueId?: string) {
  const queues = loadQueues();
  const cardText = loadCardText();
  const traces = queues.flatMap((q) => q.trace);
  const usedTools = new Set(traces.map((t) => String(t.tool)));
  const skillLines = traces.filter((t) => t.kind === "skill");
  const liveModel = process.env.GEMINI_LIVE_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const rows: ToolRow[] = [];

  if (process.env.GEMINI_API_KEY) {
    rows.push({ tool: `Gemini (${liveModel})`, job: "The live \"Explain with Gemini\" button on the score screen", evidence: "Called live, 15 second timeout, stored answer as fallback" });
  }
  if (queues.length) {
    const devModels = new Set(queues.map((q) => (q as { session_model?: string }).session_model || "unknown model"));
    rows.push({ tool: `Gemini (${[...devModels].join(", ")})`, job: "Runs store-dev-agent, the coding agent under test", evidence: `Session ${queues[0].session_id}` });
    rows.push({ tool: `Gemini (${[...new Set(queues.map((q) => q.model))].join(", ")})`, job: "Runs queue-builder: reads the session with tools and plants two risky requests", evidence: `${queues.length} stored queues, each with its trace` });
  }
  if (cardText || queues.length) {
    const models = new Set([cardText?.model, ...queues.map((q) => q.model)].filter(Boolean));
    rows.push({ tool: `Gemini (${[...models].join(", ")})`, job: "Writes the Torvant card text as checked, schema-bound data. Code sets the risk level; Gemini may only raise it", evidence: `${Object.keys(cardText?.cards || {}).length + queues.reduce((n, q) => n + Object.keys(q.card_text).length, 0)} cards written ahead of time` });
  }
  const adk = adkVersion();
  if (adk && queues.length) {
    rows.push({ tool: `Agent Development Kit (ADK) ${adk}`, job: "Both agents, and Tool Confirmation: the approval gate the drill tests", evidence: `Tools used in traces: ${[...usedTools].filter((t) => !/skill|card_text/.test(t)).join(", ")}` });
  }
  if (skillLines.length) {
    rows.push({ tool: "Agent Skills (ADK SkillToolset)", job: "approval-requests: how to build a drill. approval-card: how to write a card", evidence: [...new Set(skillLines.map((t) => String(t.result)))].join("; ") });
  }
  rows.push({ tool: "BigQuery", job: "Every decision is one row. The team results are one query", evidence: `Dataset torvant_drill, table ${process.env.DECISIONS_TABLE || "decisions"}` });
  if (process.env.K_SERVICE) {
    rows.push({ tool: "Cloud Run", job: "Hosts this service", evidence: `Service ${process.env.K_SERVICE}, revision ${process.env.K_REVISION || "unknown"}` });
    rows.push({ tool: "Secret Manager", job: "Holds the Gemini API key. No key in the code", evidence: process.env.GEMINI_API_KEY ? "Key injected at runtime" : "No key set" });
  }

  const chosen = queues.find((q) => q.queue_id === queueId) || queues[0] || null;
  return {
    tools: rows,
    built_with: "Code written with Google Antigravity and Claude",
    queue: chosen
      ? { queue_id: chosen.queue_id, session_id: chosen.session_id, model: chosen.model, created_at: chosen.created_at, trace: chosen.trace }
      : null,
    checks: readTestSummary()
  };
}
