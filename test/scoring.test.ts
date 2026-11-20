import assert from "node:assert";
import { describe, it } from "node:test";
import { calculateRoundScore } from "../src/scoring";
import { Card, DecisionRecord } from "../src/types";

const mockCards: Card[] = [
  { id: "1", task: "Normal task 1", command: "echo 1", isRisky: false },
  { id: "2", task: "Normal task 2", command: "echo 2", isRisky: false },
  { id: "3", task: "Risky task 1", command: "bad 1", isRisky: true, denialReason: "Risk 1 reason" },
  { id: "4", task: "Normal task 3", command: "echo 3", isRisky: false },
  { id: "5", task: "Risky task 2", command: "bad 2", isRisky: true, denialReason: "Risk 2 reason" },
  { id: "6", task: "Normal task 4", command: "echo 4", isRisky: false },
  { id: "7", task: "Normal task 5", command: "echo 5", isRisky: false },
  { id: "8", task: "Normal task 6", command: "echo 6", isRisky: false }
];

describe("Scoring Pure Function", () => {
  it("gives a clearly poor result when a player denies everything", () => {
    const decisions: DecisionRecord[] = mockCards.map((c) => ({
      cardId: c.id,
      decision: "denied",
      secondsTaken: 2.5
    }));

    const result = calculateRoundScore("Round A", mockCards, decisions);

    assert.strictEqual(result.riskyCaught, 2, "Should catch both risky requests");
    assert.strictEqual(result.wronglyBlocked, 6, "Should record 6 wrongly blocked normal requests");
    assert.strictEqual(result.normalApproved, 0);
    assert.strictEqual(result.overallRating, "Poor (Blocked Everything)", "A player who blocks everything gets a poor rating");
  });

  it("gives an excellent result when a player correctly denies risky and approves normal", () => {
    const decisions: DecisionRecord[] = mockCards.map((c) => ({
      cardId: c.id,
      decision: c.isRisky ? "denied" : "approved",
      secondsTaken: 3.0
    }));

    const result = calculateRoundScore("Round A", mockCards, decisions);

    assert.strictEqual(result.riskyCaught, 2);
    assert.strictEqual(result.wronglyBlocked, 0);
    assert.strictEqual(result.normalApproved, 6);
    assert.strictEqual(result.overallRating, "Excellent");
    assert.strictEqual(result.avgSecondsPerDecision, 3.0);
  });

  it("evaluates to 'Missed a risky request' (never Good or Excellent) if any risky request is approved", () => {
    // Player correctly approves all 6 normal cards, denies 1 risky card, but mistakenly approves 1 risky card
    const decisions: DecisionRecord[] = mockCards.map((c) => {
      if (c.id === "3") {
        return { cardId: c.id, decision: "denied", secondsTaken: 2.0 }; // risky card 1 caught
      }
      if (c.id === "5") {
        return { cardId: c.id, decision: "approved", secondsTaken: 2.0 }; // risky card 2 mistakenly approved
      }
      return { cardId: c.id, decision: "approved", secondsTaken: 2.0 }; // normal cards approved
    });

    const result = calculateRoundScore("Round A", mockCards, decisions);

    assert.strictEqual(result.riskyCaught, 1);
    assert.strictEqual(result.wronglyBlocked, 0);
    assert.strictEqual(result.overallRating, "Missed a risky request");
    assert.notStrictEqual(result.overallRating, "Good");
    assert.notStrictEqual(result.overallRating, "Excellent");
  });

  it("handles player who approves everything with 'Missed a risky request'", () => {
    const decisions: DecisionRecord[] = mockCards.map((c) => ({
      cardId: c.id,
      decision: "approved",
      secondsTaken: 1.5
    }));

    const result = calculateRoundScore("Round A", mockCards, decisions);

    assert.strictEqual(result.riskyCaught, 0);
    assert.strictEqual(result.wronglyBlocked, 0);
    assert.strictEqual(result.normalApproved, 6);
    assert.strictEqual(result.overallRating, "Missed a risky request");
  });

  it("handles timeout with not reached cards correctly", () => {
    const decisions: DecisionRecord[] = [
      { cardId: "1", decision: "approved", secondsTaken: 10 },
      { cardId: "2", decision: "approved", secondsTaken: 20 },
      { cardId: "3", decision: "denied", secondsTaken: 30 }
      // Remaining 5 cards not reached
    ];

    const result = calculateRoundScore("Round A", mockCards, decisions);

    assert.strictEqual(result.notReached, 5);
    assert.strictEqual(result.avgSecondsPerDecision, 20.0);
    assert.strictEqual(result.overallRating, "Needs Attention");
  });

  it("is a pure function that does not mutate inputs", () => {
    const originalCards = JSON.parse(JSON.stringify(mockCards));
    const decisions: DecisionRecord[] = [
      { cardId: "1", decision: "approved", secondsTaken: 5 }
    ];
    const originalDecisions = JSON.parse(JSON.stringify(decisions));

    const result1 = calculateRoundScore("Round A", mockCards, decisions);
    const result2 = calculateRoundScore("Round A", mockCards, decisions);

    assert.deepStrictEqual(result1, result2, "Output must be identical for identical inputs");
    assert.deepStrictEqual(mockCards, originalCards, "Cards array must not be mutated");
    assert.deepStrictEqual(decisions, originalDecisions, "Decisions array must not be mutated");
  });
});
