import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import path from "path";
import { DecisionRow, enqueueDecision, getTeamResults } from "./bigquery";
import { combineExplanation, generateCardText } from "./card_text";
import { loadCardText, toPublicCard } from "./cards_store";
import { teamSentence, toAnswerRow } from "./answers";
import { enqueueAnswer, getAnswerCounts } from "./answers_store";
import { buildHow } from "./how";
import { findCard, pickRounds, roundByKey } from "./queues";
import { risk_flags } from "./risk_rules";
import { calculateRoundScore } from "./scoring";
import { Card, DecisionRecord } from "./types";

const app = express();
const port = parseInt(process.env.PORT || "8080", 10);
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// Live explain uses the fast model so it fits inside its timeout.
const liveModel = process.env.GEMINI_LIVE_MODEL || geminiModel;
const LIVE_TIMEOUT_MS = 15000;
const LIVE_LIMIT_PER_HOUR = 30;

app.use(express.json({ limit: "64kb" }));
// Only public/ is served as files. data/ is NOT served, so answers stay on the server.
app.use(express.static(path.resolve(process.cwd(), "public")));

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// The two rounds for one play, as the phone sees them before a decision:
// task, command, level and card text. No risky flag, risk type or reason.
app.get("/api/drill/rounds", (_req: Request, res: Response) => {
  try {
    const { source, rounds } = pickRounds();
    const view = (r: (typeof rounds)[number]) => ({
      key: r.key,
      name: r.name,
      cards: r.cards.map((c) => toPublicCard(c, r.text[c.id]))
    });
    const text = loadCardText();
    res.json({
      source,
      roundA: view(rounds[0]),
      roundB: view(rounds[1]),
      card_text: text ? { model: text.model, generated_at: text.generated_at } : null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error loading drill data";
    res.status(500).json({ error: message });
  }
});

const DECISIONS = new Set(["approved", "denied", "not reached"]);
const VARIANTS = new Set(["plain", "torvant"]);

// Records one decision. The server, not the phone, says whether the card was risky.
app.post("/api/drill/decision", (req: Request, res: Response) => {
  res.status(200).json({ status: "queued" });

  const b = (req.body || {}) as Partial<DecisionRow>;
  const card = b.card_id ? findCard(String(b.card_id))?.card : undefined;
  if (!card || !b.player_id || !DECISIONS.has(String(b.decision)) || !VARIANTS.has(String(b.card_variant))) {
    return;
  }
  const seconds = Math.max(0, Math.min(600, Number(b.seconds) || 0));
  enqueueDecision({
    play_id: String(b.play_id || "").slice(0, 64),
    player_id: String(b.player_id).slice(0, 64),
    ts: new Date().toISOString(),
    round: String(b.round || "").slice(0, 32),
    card_variant: String(b.card_variant),
    queue_id: String(b.queue_id || "").slice(0, 64),
    position: Math.max(1, Math.min(8, Number(b.position) || 1)),
    card_id: card.id,
    risky: Boolean(card.isRisky),
    risk_type: card.risk_type || null,
    decision: String(b.decision),
    seconds: Number(seconds.toFixed(1)),
    reached: b.decision !== "not reached"
  });
});

// Optional answers from the final summary. Responds at once; the write never blocks the screen.
app.post("/api/answers", (req: Request, res: Response) => {
  res.status(200).json({ status: "queued" });
  const row = toAnswerRow(req.body);
  if (row) enqueueAnswer(row);
});

app.post("/api/drill/score", (req: Request, res: Response) => {
  try {
    const { roundKey, decisions } = req.body as { roundKey: string; decisions: DecisionRecord[] };
    const r = roundByKey(String(roundKey || ""));
    if (!r || !Array.isArray(decisions)) {
      res.status(400).json({ error: "Unknown round or missing decisions array" });
      return;
    }
    res.json(calculateRoundScore(r.name, r.cards, decisions));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error calculating score";
    res.status(500).json({ error: message });
  }
});

// Live "Explain with Gemini" button. Limited and timed out; falls back to the stored text.
const liveCalls: number[] = [];
app.post("/api/explain", async (req: Request, res: Response) => {
  const found = findCard(String((req.body || {}).cardId || ""));
  if (!found) {
    res.status(400).json({ error: "Unknown card" });
    return;
  }
  const card = found.card;
  const stored = found.text;
  const storedAnswer = (reason: string) =>
    res.json({ source: "stored", reason, model: stored?.model || null, text: stored || null });

  const apiKey = process.env.GEMINI_API_KEY;
  const now = Date.now();
  while (liveCalls.length && now - liveCalls[0] > 3600_000) liveCalls.shift();
  if (!apiKey) return storedAnswer("no key");
  if (liveCalls.length >= LIVE_LIMIT_PER_HOUR) return storedAnswer("live limit reached");
  liveCalls.push(now);

  try {
    const rules = risk_flags(card.task, card.command);
    const live = await generateCardText(apiKey, liveModel, card.task, card.command, rules, LIVE_TIMEOUT_MS);
    res.json({ source: "live", model: liveModel, text: combineExplanation(stored, live) });
  } catch (err) {
    console.warn("Live explain failed:", (err as Error).message);
    storedAnswer("live call failed or timed out");
  }
});

app.get("/api/team/results", async (_req: Request, res: Response) => {
  try {
    const results = await getTeamResults();
    const told = await getAnswerCounts().catch(() => null);
    res.json({ ...results, summary_sentence: teamSentence(results.variants), what_players_told_us: told });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error querying team results";
    res.status(500).json({ error: message });
  }
});

app.get("/api/how", (req: Request, res: Response) => {
  res.json(buildHow(typeof req.query.queue === "string" ? req.query.queue : undefined));
});

app.get("/how", (_req: Request, res: Response) => {
  res.sendFile(path.resolve(process.cwd(), "public/how.html"));
});

app.get("/team", (_req: Request, res: Response) => {
  res.sendFile(path.resolve(process.cwd(), "public/team.html"));
});

// Kept from Step 1: a one-line Gemini check.
app.post("/api/hello", async (_req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY is not set in environment or Secret Manager." });
    return;
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Say hello in one short line" }] }] })
      }
    );
    const data = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      res.status(response.status).json({ error: data?.error?.message || `Gemini responded with status ${response.status}` });
      return;
    }
    res.json({ reply: data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No reply", model: geminiModel });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
  }
});

app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.resolve(process.cwd(), "public/index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Torvant Drill server running on port ${port} (model: ${geminiModel})`);
});
