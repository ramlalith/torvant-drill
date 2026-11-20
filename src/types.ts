export interface Card {
  id: string;
  task: string;
  command: string;
  isRisky: boolean;
  denialReason?: string;
  riskType?: string;
}

export interface DecisionRecord {
  cardId: string;
  decision: "denied" | "approved" | "not reached";
  secondsTaken: number;
}

export interface RoundScore {
  roundName: string;
  riskyCaught: number;
  totalRisky: number;
  wronglyBlocked: number;
  totalNormal: number;
  normalApproved: number;
  notReached: number;
  avgSecondsPerDecision: number;
  overallRating: "Excellent" | "Good" | "Needs Attention" | "Poor (Blocked Everything)";
  riskyBreakdown: Array<{
    cardId: string;
    task: string;
    command: string;
    decision: "denied" | "approved" | "not reached";
    caught: boolean;
    denialReason: string;
  }>;
}

export interface DrillRoundsData {
  roundA: {
    name: string;
    cards: Card[];
  };
  roundB: {
    name: string;
    cards: Card[];
  };
}
