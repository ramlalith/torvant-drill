import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { Card } from "../src/types";

describe("Drill Flow: variant assignment and card order", () => {
  const cardsPath = path.resolve(process.cwd(), "data/cards.json");
  const roundsPath = path.resolve(process.cwd(), "data/rounds.json");

  const cards: Card[] = JSON.parse(fs.readFileSync(cardsPath, "utf-8"));
  const rounds = JSON.parse(fs.readFileSync(roundsPath, "utf-8"));

  const cardMap = new Map<string, Card>(cards.map((c) => [c.id, c]));

  const roundACards: Card[] = (rounds.roundA.cardIds as string[]).map(
    (id) => cardMap.get(id)!
  );
  const roundBCards: Card[] = (rounds.roundB.cardIds as string[]).map(
    (id) => cardMap.get(id)!
  );

  it("every player sees both variants — one per round", () => {
    // Simulate all four possible (roundOrder, variantOrder) combinations.
    // In every combination the two rounds must carry different variants.
    const roundOrders: Array<["roundA" | "roundB", "roundA" | "roundB"]> = [
      ["roundA", "roundB"],
      ["roundB", "roundA"],
    ];
    const variantOrders: Array<["plain" | "torvant", "plain" | "torvant"]> = [
      ["plain", "torvant"],
      ["torvant", "plain"],
    ];

    for (const ro of roundOrders) {
      for (const vo of variantOrders) {
        // play 0: round ro[0] with variant vo[0]
        // play 1: round ro[1] with variant vo[1]
        const variantForPlay0 = vo[0];
        const variantForPlay1 = vo[1];

        // The two variants must be different
        assert.notStrictEqual(
          variantForPlay0,
          variantForPlay1,
          `Both plays must use different variants (got ${variantForPlay0} twice)`
        );

        // Together they must cover both "plain" and "torvant"
        const seen = new Set([variantForPlay0, variantForPlay1]);
        assert(seen.has("plain"), "plain variant must be used in one round");
        assert(seen.has("torvant"), "torvant variant must be used in one round");
      }
    }
  });

  it("Round A card order is fixed and matches rounds.json (no shuffle)", () => {
    const expectedIds = rounds.roundA.cardIds as string[];
    assert.strictEqual(roundACards.length, expectedIds.length, "Round A must have correct number of cards");
    for (let i = 0; i < expectedIds.length; i++) {
      assert.strictEqual(
        roundACards[i].id,
        expectedIds[i],
        `Round A position ${i + 1}: expected ${expectedIds[i]}, got ${roundACards[i].id}`
      );
    }
  });

  it("Round B card order is fixed and matches rounds.json (no shuffle)", () => {
    const expectedIds = rounds.roundB.cardIds as string[];
    assert.strictEqual(roundBCards.length, expectedIds.length, "Round B must have correct number of cards");
    for (let i = 0; i < expectedIds.length; i++) {
      assert.strictEqual(
        roundBCards[i].id,
        expectedIds[i],
        `Round B position ${i + 1}: expected ${expectedIds[i]}, got ${roundBCards[i].id}`
      );
    }
  });

  it("risky cards are at positions 4 and 7 in both rounds (1-based, fixed order)", () => {
    for (const [label, roundCards] of [["Round A", roundACards], ["Round B", roundBCards]] as const) {
      assert.strictEqual(
        roundCards.length,
        8,
        `${label} must have 8 cards`
      );
      assert(
        roundCards[3].isRisky,
        `${label}: card at position 4 (index 3) must be risky, got ${roundCards[3].id}`
      );
      assert(
        roundCards[6].isRisky,
        `${label}: card at position 7 (index 6) must be risky, got ${roundCards[6].id}`
      );
      // All other positions must be normal
      for (let i = 0; i < 8; i++) {
        if (i !== 3 && i !== 6) {
          assert(
            !roundCards[i].isRisky,
            `${label}: position ${i + 1} must be normal, got ${roundCards[i].id} (risky=${roundCards[i].isRisky})`
          );
        }
      }
    }
  });
});
