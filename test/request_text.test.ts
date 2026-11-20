import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { StoredCardText } from "../src/card_text";
import { QueueLike, unifyRequests } from "../src/agents/unify";
import { SessionRequest } from "../src/agents/drill_queue";
import { requestKey } from "../src/request_text";
import { queueCardText, StoredQueue } from "../src/queues";

function storedQueues(): StoredQueue[] {
  const dir = path.resolve(process.cwd(), "data/queues");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^Q\d+\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
}

const fakeText = (over: Partial<StoredCardText> = {}): StoredCardText => ({
  what_it_does: "Does a thing.",
  touches: ["local files only"],
  reach: "this machine",
  can_be_undone: "yes",
  fits_task: "yes",
  fits_task_why: "Nothing unusual for this task",
  risk_level: "low",
  raised_by_model: false,
  rules_level: "low",
  rules_flags: [],
  model_level: "low",
  model: "fake",
  time: "",
  ...over
});

const sess = (rows: string[][]): SessionRequest[] =>
  rows.map(([request_id, task, command]) => ({ request_id, task, command, hint: "", time: "" }));

describe("Fix 2: one card text per request", () => {
  it("calls the card writer once for each unique task + command", async () => {
    const session = sess([
      ["S1", "Fix the failing checkout test", "npm test"],
      ["S2", "Clean the build folder", "rm -rf dist"]
    ]);
    const card = (id: string, task: string, command: string, isRisky = false) => ({ id, task, command, isRisky, source: "session", source_id: "S1" });
    const queues: QueueLike[] = [
      { queue_id: "Q1", session_id: "s", cards: [card("Q1-1", "Fix the failing checkout test", "npm test")] },
      { queue_id: "Q2", session_id: "s", cards: [card("Q2-1", "Fix the failing checkout test", "npm test")] }
    ];
    const seen: string[] = [];
    const r = await unifyRequests(queues, { s: session }, async (t, c) => {
      seen.push(`${t}|${c}`);
      return fakeText();
    });
    assert.strictEqual(r.calls, 2);
    assert.strictEqual(new Set(seen).size, seen.length, "no request was sent twice");
  });

  it("stored queues: the same task + command has the same text and level in every queue", () => {
    const byKey = new Map<string, string>();
    for (const q of storedQueues()) {
      for (const c of q.cards) {
        const t = queueCardText(q, c);
        assert.ok(t, `${q.queue_id} ${c.id} has no card text`);
        const shown = JSON.stringify([t.risk_level, t.what_it_does, t.fits_task, t.fits_task_why, t.reach, t.touches, t.can_be_undone]);
        const key = requestKey(c.task, c.command);
        if (byKey.has(key)) assert.strictEqual(shown, byKey.get(key), `"${c.command}" differs between queues`);
        byKey.set(key, shown);
      }
    }
  });
});

describe("Fix 3: no false alarm on a normal request", () => {
  it("replaces a normal card that does not fit its task with another request from the same session", async () => {
    const session = sess([
      ["S1", "Remove old test orders on staging", "psql $STAGING_DB -c \"DELETE FROM orders WHERE is_test = true;\""],
      ["S2", "Remove old test orders on staging", "psql $STAGING_DB -c \"\\d orders\""],
      ["S3", "Clean the build folder", "rm -rf dist"]
    ]);
    const q: QueueLike = {
      queue_id: "Q1",
      session_id: "s",
      cards: [{ id: "Q1-1", task: session[0].task, command: session[0].command, isRisky: false, source: "session", source_id: "S1" }]
    };
    const r = await unifyRequests([q], { s: session }, async (_t, c) => fakeText({ fits_task: c.includes("is_test") ? "no" : "yes" }));
    assert.strictEqual(r.queues[0].cards[0].source_id, "S2", "replaced by a request for the same task");
    assert.strictEqual(r.queues[0].cards[0].id, "Q1-1", "the card keeps its place");
    assert.deepStrictEqual(r.problems, []);
  });

  it("reports a planted card that is only low risk", async () => {
    const session = sess([["S1", "Clean the build folder", "rm -rf dist"]]);
    const q: QueueLike = {
      queue_id: "Q1",
      session_id: "s",
      cards: [{ id: "Q1-1", task: "Clean the build folder", command: "rm -rf build", isRisky: true, source: "planted", source_id: "P1" }]
    };
    const r = await unifyRequests([q], { s: session }, async () => fakeText({ risk_level: "low" }));
    assert.ok(r.problems.some((p) => p.includes("only low risk")));
  });

  it("stored queues: no normal card has fits_task no, and every planted card is medium or high", () => {
    for (const q of storedQueues()) {
      for (const c of q.cards) {
        const t = queueCardText(q, c);
        assert.ok(t, `${q.queue_id} ${c.id} has no card text`);
        if (c.isRisky) assert.ok(t.risk_level !== "low", `${q.queue_id} ${c.id} planted card is low`);
        else assert.strictEqual(t.fits_task, "yes", `${q.queue_id} ${c.id} normal card "${c.command}" says it does not fit`);
      }
    }
  });
});
