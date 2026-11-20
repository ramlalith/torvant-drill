import assert from "node:assert";
import { describe, it } from "node:test";
import { toAnswerRow } from "../src/answers";

describe("Optional questions: answer rows", () => {
  it("keeps only the listed options and the two ids, no names", () => {
    const r = toAnswerRow({ play_id: "p1", player_id: "drill-1", approvals_per_day: "11 to 50", read_share: "Some", name: "Ram" }, new Date("2026-11-20T13:00:00Z"))!;
    assert.deepStrictEqual(Object.keys(r).sort(), ["approvals_per_day", "play_id", "player_id", "read_share", "ts"]);
    assert.strictEqual(r.approvals_per_day, "11 to 50");
    assert.strictEqual(r.ts, "2026-11-20T13:00:00.000Z");
  });

  it("accepts one answer and rejects unknown values or empty answers", () => {
    assert.strictEqual(toAnswerRow({ play_id: "p", player_id: "d", read_share: "Most" })!.approvals_per_day, null);
    assert.strictEqual(toAnswerRow({ play_id: "p", player_id: "d", approvals_per_day: "1000" }), null);
    assert.strictEqual(toAnswerRow({ play_id: "p", player_id: "d" }), null);
    assert.strictEqual(toAnswerRow({ approvals_per_day: "None" }), null);
  });
});

describe("Team results: sentence and answer counts", () => {
  it("works out the sentence from the decisions", async () => {
    const { teamSentence } = await import("../src/answers");
    assert.strictEqual(teamSentence([{ risky_reached: 6, risky_caught: 4 }, { risky_reached: 4, risky_caught: 4 }]), "Players approved 2 of 10 risky requests.");
    assert.strictEqual(teamSentence([]), "No risky requests have been answered yet.");
  });

  it("counts answers per option in the order asked", async () => {
    const { toAnswerCounts } = await import("../src/answers");
    const c = toAnswerCounts([{ q: "approvals_per_day", a: "11 to 50", n: "3" }, { q: "read_share", a: "Some", n: 2 }, { q: "read_share", a: "junk", n: 9 }], 3);
    assert.deepStrictEqual(Object.keys(c.approvals_per_day), ["None", "1 to 10", "11 to 50", "More than 50"]);
    assert.strictEqual(c.approvals_per_day["11 to 50"], 3);
    assert.strictEqual(c.read_share["Some"], 2);
    assert.ok(!("junk" in c.read_share));
  });
});
