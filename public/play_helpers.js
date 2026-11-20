// Small pure helpers for the play screen. Loaded by the page before app.js,
// and by the unit tests in Node. No DOM, no network.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PlayHelpers = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Tap lock. One tap answers one card: after a tap, every tap is ignored
  // until the next card is shown, and for the first lockMs of a new card.
  function createTapGuard(lockMs, now) {
    const clock = now || function () { return Date.now(); };
    let busy = false;
    let until = 0;
    return {
      cardShown: function () { busy = false; until = clock() + lockMs; },
      tryTake: function () {
        if (busy || clock() < until) return false;
        busy = true;
        return true;
      }
    };
  }

  // The two dim lines above the request: the player's last two answers in
  // this round, shown like terminal output. Starts with two agent lines.
  const START_LINES = ["> list_files  (8 files)", "> read_file  deploy/README.md"];
  function shorten(text, width) {
    return text.length > width ? text.slice(0, width - 1) + "…" : text;
  }
  function historyLines(answers, width) {
    const w = width || 34;
    const done = (answers || []).map(function (a) {
      const mark = a.decision === "approved" ? "✓ approved  " : a.decision === "denied" ? "✕ denied    " : "· skipped   ";
      return shorten(mark + a.command, w);
    });
    return START_LINES.concat(done).slice(-2);
  }

  // "Request 3 of 8" and an 8 step bar.
  function progressText(current, total) {
    return "Request " + current + " of " + total;
  }
  function progressBar(current, total) {
    return "■".repeat(Math.max(0, current)) + "□".repeat(Math.max(0, total - current));
  }

  return { createTapGuard: createTapGuard, historyLines: historyLines, progressText: progressText, progressBar: progressBar };
});
