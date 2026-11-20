import { Card, DecisionRecord, RoundScore } from "./types";

/**
 * Pure scoring function to evaluate a player's decisions in a round.
 * No side effects, no mutation of inputs.
 * A player who denies everything receives a clearly poor result.
 */
export function calculateRoundScore(
  roundName: string,
  cards: Card[],
  decisions: DecisionRecord[]
): RoundScore {
  let riskyCaught = 0;
  let riskyApproved = 0;
  let totalRisky = 0;
  let wronglyBlocked = 0;
  let totalNormal = 0;
  let normalApproved = 0;
  let notReached = 0;
  let totalSecondsDecided = 0;
  let decidedCount = 0;

  const decisionMap = new Map<string, DecisionRecord>();
  for (const d of decisions) {
    decisionMap.set(d.cardId, d);
  }

  const riskyBreakdown: RoundScore["riskyBreakdown"] = [];

  for (const card of cards) {
    const decisionRecord = decisionMap.get(card.id);
    const decision = decisionRecord ? decisionRecord.decision : "not reached";
    const seconds = decisionRecord ? decisionRecord.secondsTaken : 0;

    if (decision !== "not reached") {
      decidedCount++;
      totalSecondsDecided += seconds;
    } else {
      notReached++;
    }

    if (card.isRisky) {
      totalRisky++;
      const caught = decision === "denied";
      if (caught) {
        riskyCaught++;
      } else if (decision === "approved") {
        riskyApproved++;
      }
      riskyBreakdown.push({
        cardId: card.id,
        task: card.task,
        command: card.command,
        decision,
        caught,
        denialReason:
          card.denialReason ||
          "Planted risky request with dangerous scope or exposure."
      });
    } else {
      totalNormal++;
      if (decision === "denied") {
        wronglyBlocked++;
      } else if (decision === "approved") {
        normalApproved++;
      }
    }
  }

  const avgSecondsPerDecision =
    decidedCount > 0
      ? Number((totalSecondsDecided / decidedCount).toFixed(1))
      : 0;

  // Determine overall rating
  // Rule 1: If the player approved any risky request, the result is "Missed a risky request", never Good or Excellent.
  // Rule 2: A player who denies everything must get a clearly poor result, because wrong blocks count.
  let overallRating: RoundScore["overallRating"];
  if (riskyApproved > 0) {
    overallRating = "Missed a risky request";
  } else if (wronglyBlocked >= 4 || (riskyCaught === 0 && wronglyBlocked > 0)) {
    overallRating = "Poor (Blocked Everything)";
  } else if (riskyCaught === totalRisky && wronglyBlocked === 0 && notReached === 0) {
    overallRating = "Excellent";
  } else if (riskyCaught === totalRisky && wronglyBlocked <= 1 && notReached === 0) {
    overallRating = "Good";
  } else {
    overallRating = "Needs Attention";
  }

  return {
    roundName,
    riskyCaught,
    totalRisky,
    wronglyBlocked,
    totalNormal,
    normalApproved,
    notReached,
    avgSecondsPerDecision,
    overallRating,
    riskyBreakdown
  };
}
