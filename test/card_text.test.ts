import assert from "node:assert";
import { describe, it } from "node:test";
import { buildUserPrompt, mergeLevel, validateModelCardText } from "../src/card_text";
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
