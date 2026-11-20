import assert from "node:assert";
import { describe, it } from "node:test";
import { buildUserPrompt, chooseNewest, mergeLevel, validateModelCardText } from "../src/card_text";
import { loadCards, toPublicCard } from "../src/cards_store";

const good = {
  what_it_does: "Opens the database to anyone on the internet.",
  touches: ["the internet", "production data"],
  reach: "everyone on the internet",
  can_be_undone: "partly",
  fits_task: "no",
  fits_task_why: "The task needs one reviewer, not the whole internet.",
  risk_level: "high",
  raised_by_model: false
};

describe("Card text: Gemini output is checked data", () => {
  it("accepts a valid card", () => {
    assert.deepStrictEqual(validateModelCardText(good), []);
  });

  it("rejects a card that calls a command safe", () => {
    const bad = { ...good, fits_task_why: "This is safe to run." };
    assert.ok(validateModelCardText(bad).includes("says safe"));
  });

  it("rejects long fields, unknown values and missing fields", () => {
    const bad = {
      ...good,
      reach: "one two three four five six seven eight nine",
      touches: ["the moon"],
      can_be_undone: "maybe"
    };
    const p = validateModelCardText(bad);
    assert.ok(p.includes("reach over 8 words"));
    assert.ok(p.includes("touches has an unknown value"));
    assert.ok(p.includes("can_be_undone invalid"));
    assert.ok(validateModelCardText({}).length > 0);
    assert.ok(validateModelCardText("text").length > 0);
  });
});

describe("Card text: Gemini can raise a level, never lower it", () => {
  it("never lowers the code level", () => {
    assert.deepStrictEqual(mergeLevel("high", "low", true), { level: "high", raised: false });
    assert.deepStrictEqual(mergeLevel("medium", "low", false), { level: "medium", raised: false });
  });

  it("raises only when Gemini says it raised", () => {
    assert.deepStrictEqual(mergeLevel("medium", "high", true), { level: "high", raised: true });
    assert.deepStrictEqual(mergeLevel("medium", "high", false), { level: "medium", raised: false });
  });

  it("asks Gemini to check look-alike package names on installs only", () => {
    assert.match(buildUserPrompt("t", "npm install date-fnss", ["unknown software"], "medium"), /well known packages/);
    assert.doesNotMatch(buildUserPrompt("t", "git push origin x", [], "low"), /well known packages/);
  });
});

describe("Public card view hides the answer", () => {
  it("sends no risky flag, risk type or reason to the phone", () => {
    for (const card of loadCards()) {
      const pub = toPublicCard(card, undefined) as unknown as Record<string, unknown>;
      for (const key of ["isRisky", "risky", "risk_type", "riskType", "why_deny", "denialReason"]) {
        assert.ok(!(key in pub), `${card.id} leaks ${key}`);
      }
      assert.ok(["low", "medium", "high"].includes(pub.level as string));
    }
  });
});

describe("Model picker", () => {
  it("picks the newest version, including preview names", () => {
    const names = ["models/gemini-2.5-pro", "models/gemini-3.1-pro-preview", "models/gemini-3.8-flash", "models/gemini-2.5-flash"];
    assert.strictEqual(chooseNewest(names, "pro"), "gemini-3.1-pro-preview");
    assert.strictEqual(chooseNewest(names, "flash"), "gemini-3.8-flash");
    assert.strictEqual(chooseNewest(["models/gemini-3.1-pro-preview", "models/gemini-3.1-pro"], "pro"), "gemini-3.1-pro");
    assert.strictEqual(chooseNewest(["models/gemini-3.1-pro-preview-tts"], "pro"), null);
    assert.strictEqual(chooseNewest(["models/gemini-3.1-pro-preview-06-05"], "pro"), "gemini-3.1-pro-preview-06-05");
  });
});

describe("Fix 4: live explain never contradicts the stored card", () => {
  it("shows the higher level and 'no' if either answer says no", async () => {
    const { combineExplanation } = await import("../src/card_text");
    const stored = { ...good, risk_level: "high", fits_task: "no", fits_task_why: "Stored reason." } as any;
    const live = { ...good, risk_level: "medium", fits_task: "yes", fits_task_why: "Live reason." } as any;
    const a = combineExplanation(stored, live);
    assert.strictEqual(a.risk_level, "high");
    assert.strictEqual(a.fits_task, "no");
    assert.strictEqual(a.fits_task_why, "Stored reason.");
    const b = combineExplanation({ ...live, risk_level: "low" }, { ...stored, fits_task_why: "Live no." });
    assert.strictEqual(b.risk_level, "high");
    assert.strictEqual(b.fits_task_why, "Live no.");
    assert.strictEqual(combineExplanation(undefined, live).risk_level, "medium");
  });
});
