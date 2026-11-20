import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { DecisionRow, enqueueDecision, getTeamResults } from "./bigquery";
import { risk_flags } from "./risk_rules";
import { calculateRoundScore } from "./scoring";
import { Card, DecisionRecord, DrillRoundsData } from "./types";

const app = express();
const port = parseInt(process.env.PORT || "8080", 10);
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Serve static files from public/ and data/ directories
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));
app.use("/data", express.static(path.resolve(process.cwd(), "data")));

// Load drill cards and rounds from data directory
function loadDrillData(): DrillRoundsData {
  const cardsPath = path.resolve(process.cwd(), "data/cards.json");
  const roundsPath = path.resolve(process.cwd(), "data/rounds.json");

  const cards: Card[] = JSON.parse(fs.readFileSync(cardsPath, "utf-8"));
  const rounds = JSON.parse(fs.readFileSync(roundsPath, "utf-8"));

  const cardMap = new Map<string, Card>();
  for (const c of cards) {
    cardMap.set(c.id, c);
  }

  const roundACards: Card[] = (rounds.roundA.cardIds as string[])
    .map((id) => cardMap.get(id))
    .filter((c): c is Card => Boolean(c));

  const roundBCards: Card[] = (rounds.roundB.cardIds as string[])
    .map((id) => cardMap.get(id))
    .filter((c): c is Card => Boolean(c));

  return {
    roundA: {
      name: rounds.roundA.name || "Round A",
      cards: roundACards
    },
    roundB: {
      name: rounds.roundB.name || "Round B",
      cards: roundBCards
    }
  };
}

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// API to retrieve drill rounds (cards enriched with riskAnalysis for Torvant card screen)
app.get("/api/drill/rounds", (_req: Request, res: Response) => {
  try {
    const drillData = loadDrillData();

    // Enrich each card with riskAnalysis (pure function, no AI)
    const enriched: DrillRoundsData = {
      roundA: {
        name: drillData.roundA.name,
        cards: drillData.roundA.cards.map((c) => ({
          ...c,
          riskAnalysis: risk_flags(c.task, c.command)
        }))
      },
      roundB: {
        name: drillData.roundB.name,
        cards: drillData.roundB.cards.map((c) => ({
          ...c,
          riskAnalysis: risk_flags(c.task, c.command)
        }))
      }
    };

    res.json(enriched);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error loading drill data";
    res.status(500).json({ error: message });
  }
});

// API to record a single decision to BigQuery (non-blocking)
app.post("/api/drill/decision", (req: Request, res: Response) => {
  // Respond immediately so user interface is never blocked
  res.status(200).json({ status: "queued" });

  const row = req.body as DecisionRow;
  if (row && row.player_id && row.card_id) {
    enqueueDecision(row);
  }
});

// API to score a completed round using pure scoring function
app.post("/api/drill/score", (req: Request, res: Response) => {
  try {
    const { roundKey, decisions } = req.body as {
      roundKey: "roundA" | "roundB";
      decisions: DecisionRecord[];
    };

    if (!roundKey || !Array.isArray(decisions)) {
      res.status(400).json({ error: "Missing roundKey or decisions array" });
      return;
    }

    const drillData = loadDrillData();
    const roundData = drillData[roundKey];
    if (!roundData) {
      res.status(400).json({ error: `Unknown roundKey: ${roundKey}` });
      return;
    }

    const scoreResult = calculateRoundScore(roundData.name, roundData.cards, decisions);
    res.json(scoreResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error calculating score";
    res.status(500).json({ error: message });
  }
});

// API for team results (cached for 30s)
app.get("/api/team/results", async (_req: Request, res: Response) => {
  try {
    const results = await getTeamResults();
    res.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error querying team results";
    res.status(500).json({ error: message });
  }
});

// Team results page
app.get("/team", (_req: Request, res: Response) => {
  res.sendFile(path.resolve(process.cwd(), "public/team.html"));
});

// Kept from Step 1: Gemini hello route
app.post("/api/hello", async (_req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    res.status(500).json({
      error: "GEMINI_API_KEY is not set in environment or Secret Manager."
    });
    return;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Say hello in one short line"
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message =
        (errorData as { error?: { message?: string } })?.error?.message ||
        `Gemini API responded with status ${response.status}`;
      res.status(response.status).json({ error: message });
      return;
    }

    const data = await response.json();
    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No reply returned from Gemini.";

    res.json({ reply });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Internal Server Error";
    res.status(500).json({ error: errorMessage });
  }
});

app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.resolve(process.cwd(), "public/index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Torvant Drill server running on port ${port} (model: ${geminiModel})`);
});
