import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import path from "path";

const app = express();
const port = parseInt(process.env.PORT || "8080", 10);
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

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
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Torvant Drill server running on port ${port} (model: ${geminiModel})`);
});
