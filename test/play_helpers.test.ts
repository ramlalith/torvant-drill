import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const helpers = require(path.resolve(process.cwd(), "public/play_helpers.js"));
const read = (f: string) => fs.readFileSync(path.resolve(process.cwd(), f), "utf-8");

describe("Step 11, fix 1: one tap answers one card", () => {
  it("a double tap is taken once", () => {
    let t = 1000;
    const g = helpers.createTapGuard(300, () => t);
    g.cardShown();
    t += 400;
    assert.strictEqual(g.tryTake(), true);
    assert.strictEqual(g.tryTake(), false, "second tap of a double tap is ignored");
  });

  it("taps in the first 300 ms of a new card are ignored", () => {
    let t = 0;
    const g = helpers.createTapGuard(300, () => t);
    g.cardShown();
    t = 100;
    assert.strictEqual(g.tryTake(), false);
    t = 301;
    assert.strictEqual(g.tryTake(), true);
  });

  it("both buttons and the High confirm go through the lock", () => {
    const app = read("public/app.js");
    assert.match(app, /denyBtn"\)\.addEventListener\("click", \(\) => \{\s*if \(tapGuard\.tryTake\(\)\) handleDecision\("denied"\)/);
    assert.match(app, /approveBtn"\)\.addEventListener\("click", \(\) => \{\s*if \(!tapGuard\.tryTake\(\)\) return;/);
    assert.match(app, /confirmApproveBtn"\)\.addEventListener\("click", \(\) => \{\s*if \(tapGuard\.tryTake\(\)\) handleDecision\("approved"\)/);
  });
});

describe("Step 11, fix 2: every tap adds a visible line", () => {
  it("shows the agent lines first, then the player's last two answers", () => {
    assert.deepStrictEqual(helpers.historyLines([]), ["> list_files  (8 files)", "> read_file  deploy/README.md"]);
    assert.deepStrictEqual(helpers.historyLines([{ decision: "approved", command: "npm test" }]), [
      "> read_file  deploy/README.md",
      "✓ approved  npm test"
    ]);
    assert.deepStrictEqual(
      helpers.historyLines([
        { decision: "approved", command: "npm test" },
        { decision: "denied", command: "rm -rf dist" }
      ]),
      ["✓ approved  npm test", "✕ denied    rm -rf dist"]
    );
  });

  it("keeps each line short enough for one line on a phone", () => {
    const [, line] = helpers.historyLines([{ decision: "denied", command: "gcloud run deploy store-staging --source . --region asia-south1" }]);
    assert.ok(line.length <= 34 && line.endsWith("…"));
  });
});

describe("Step 11, fix 3: every new card starts at the top", () => {
  it("the play screen scrolls to the top and locks taps on each new card", () => {
    const app = read("public/app.js");
    const play = app.slice(app.indexOf("function renderPlayScreen"), app.indexOf("function renderHighConfirm"));
    assert.ok(play.includes("window.scrollTo(0, 0);"));
    assert.ok(play.includes("tapGuard.cardShown();"));
  });
});

describe("Step 11, fix 4: pressed and focus states", () => {
  it("buttons have a clear pressed state and a visible focus ring", () => {
    const css = read("public/terminal.css");
    for (const b of ["btn-deny", "btn-approve", "btn-primary"]) assert.ok(css.includes(`.${b}:active`), b);
    assert.match(css, /button:focus-visible[^{]*\{[^}]*outline: 3px solid/);
    assert.ok(!/@keyframes|transition:(?!\s*none)/.test(css), "no animation");
  });
});

describe("Step 11, fix 5: clear progress", () => {
  it("says Request N of 8 with an 8 step bar", () => {
    assert.strictEqual(helpers.progressText(3, 8), "Request 3 of 8");
    assert.strictEqual(helpers.progressBar(3, 8), "■■■□□□□□");
  });

  it("the page loads the helpers before app.js", () => {
    const html = read("public/index.html");
    assert.ok(html.indexOf("/play_helpers.js") > -1 && html.indexOf("/play_helpers.js") < html.indexOf("/app.js"));
  });
});
