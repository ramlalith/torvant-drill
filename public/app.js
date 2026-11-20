// Torvant Drill - Phone-First Application Flow
(function () {
  // Generate random player ID and play ID (no names, emails, or IP addresses stored)
  const playerId = "drill-" + Math.random().toString(36).substring(2, 10);
  const playId = "play-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 6);

  // Randomly pick which round (A/B) comes first, and which variant (plain/torvant) comes first.
  // The player plays BOTH rounds and sees BOTH variants — one per round.
  const roundOrder = Math.random() < 0.5 ? ["roundA", "roundB"] : ["roundB", "roundA"];
  const variantOrder = Math.random() < 0.5 ? ["plain", "torvant"] : ["torvant", "plain"];

  // playIndex tracks which play we're on (0 = first round, 1 = second round)
  let playIndex = 0;

  let drillData = null;
  let currentRoundKey = roundOrder[0];
  let currentCardVariant = variantOrder[0];
  let currentCardIndex = 0;
  let currentCards = [];
  let roundDecisions = [];
  let roundTimer = null;
  let roundSecondsLeft = 75;
  let cardStartTime = 0;

  let roundAScore = null;
  let roundBScore = null;

  // Title of a round by the card design used in it.
  function variantTitle(variant) {
    return variant === "torvant" ? "Torvant card" : "Plain card (how agents ask today)";
  }

  // One tap answers one card (see play_helpers.js).
  const tapGuard = PlayHelpers.createTapGuard(300, () => performance.now());

  // DOM Container
  const container = document.getElementById("app");

  // Format decision text with symbol (never color alone)
  function formatChoice(decision) {
    if (decision === "denied") return "Denied";
    if (decision === "approved") return "Approved";
    return "Not reached (time ran out)";
  }

  // Risk level in words, never colour alone
  function riskLevelLabel(level) {
    if (level === "high") return "HIGH RISK";
    if (level === "medium") return "MEDIUM RISK";
    return "LOW RISK";
  }

  // The id of the round being played: a stored queue id, or "roundA"/"roundB".
  function currentRoundId() {
    const r = drillData && drillData[currentRoundKey];
    return (r && r.key) || currentRoundKey;
  }

  // Asynchronously record decision to BigQuery endpoint (non-blocking)
  function postDecisionToBigQuery(card, decision, seconds, reached, positionIndex) {
    const payload = {
      play_id: playId,
      player_id: playerId,
      ts: new Date().toISOString(),
      round: drillData && drillData[currentRoundKey] ? drillData[currentRoundKey].name : currentRoundKey,
      card_variant: currentCardVariant,
      queue_id: currentRoundId(),               // "roundA", "roundB" or a stored queue id
      position: positionIndex + 1,              // 1-based position within the round
      card_id: card.id,
      decision: decision,
      seconds: Number(seconds.toFixed(1)),
      reached: Boolean(reached)
    };

    // Non-blocking fire-and-forget: never waits, never breaks screen
    try {
      fetch("/api/drill/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch((err) => {
        console.warn("Client decision post warning:", err);
      });
    } catch (_) {}
  }

  // Screen readers: say a short line without moving focus.
  function announce(text) {
    const el = document.getElementById("announcer");
    if (!el) return;
    el.textContent = "";
    setTimeout(() => { el.textContent = text; }, 50);
  }

  // Keyboard and screen readers: put focus on a new screen's main line, without scrolling.
  function focusFirst(selector) {
    const el = container.querySelector(selector);
    if (el) el.focus({ preventScroll: true });
  }

  // Screen 1: Start Screen
  function renderStartScreen() {
    container.innerHTML = `
      <h1>Torvant Drill</h1>
      <p class="lead-text">You are the developer on duty at Kaveri Retail, a made up store. Your coding agent asks you before each action. One wrong tap can open customer data to the internet.</p>
      
      <div class="info-note">8 requests, about 75 seconds. Some are planted tests. Nothing here is ever run. No names are stored.</div>
      <p class="info-note">One round shows requests the way agents ask today. If the commands are hard to read, that is the point.</p>

      <div class="thumb-actions">
        <button id="startBtn" class="btn-large btn-primary">
          Start drill
        </button>
      </div>
    `;

    document.getElementById("startBtn").addEventListener("click", startDrill);
  }

  // Load drill data and card_text.json from server
  async function startDrill() {
    try {
      container.innerHTML = `<p class="lead-text">Loading drill requests...</p>`;
      const res = await fetch("/api/drill/rounds");
      if (!res.ok) {
        throw new Error("Failed to load drill data from server.");
      }
      drillData = await res.json();
      // Remember the queues played, so "How it works" can show their real trace.
      try {
        localStorage.setItem("torvant_last_queue", drillData.roundA.key || "");
      } catch (_) {}

      playIndex = 0;
      currentRoundKey = roundOrder[0];
      currentCardVariant = variantOrder[0];
      startRound();
    } catch (err) {
      container.innerHTML = `
        <h2>Error Loading Drill</h2>
        <p class="info-note">${err.message}</p>
        <div class="thumb-actions">
          <button class="btn-large btn-primary" onclick="location.reload()" aria-label="Retry loading">
            Retry
          </button>
        </div>
      `;
    }
  }

  // Prepare the current round (cards keep fixed order — no shuffle)
  function startRound() {
    if (roundTimer) {
      clearInterval(roundTimer);
      roundTimer = null;
    }
    // Cards are taken as-is from server data (fixed order, risky cards at positions 4 and 7)
    currentCards = drillData[currentRoundKey].cards;
    currentCardIndex = 0;
    roundDecisions = [];
    roundSecondsLeft = 75;

    // Render the first card. Timer starts only after the first card is shown.
    renderPlayScreen();
  }

  // Timer logic for the round
  function startRoundTimer() {
    if (roundTimer) clearInterval(roundTimer);

    roundTimer = setInterval(() => {
      roundSecondsLeft--;
      const timerEl = document.getElementById("roundTimer");
      const timerNum = document.getElementById("timerNum");
      if (timerNum) timerNum.textContent = `${roundSecondsLeft}s`;
      if (timerEl && roundSecondsLeft <= 15) timerEl.classList.add("urgent");
      if (roundSecondsLeft === 30 || roundSecondsLeft === 10) announce(`${roundSecondsLeft} seconds left`);

      if (roundSecondsLeft <= 0) {
        clearInterval(roundTimer);
        roundTimer = null;
        announce("Time is up");
        handleTimeExpired();
      }
    }, 1000);
  }

  // When timer runs out, mark remaining as "not reached"
  async function handleTimeExpired() {
    while (currentCardIndex < currentCards.length) {
      const card = currentCards[currentCardIndex];
      roundDecisions.push({ cardId: card.id, decision: "not reached", secondsTaken: 0 });
      postDecisionToBigQuery(card, "not reached", 0, false, currentCardIndex);
      currentCardIndex++;
    }
    await finishRound();
  }

  // Build the Torvant card: risk level, what it does, fits the task, reach, touches, undo.
  // Rules set the lowest level. Gemini can raise it, never lower it. Gemini wrote the words ahead of time (stored, no live call here).
  function buildTorvantSection(card) {
    const level = card.level || "low";
    const t = card.text;
    if (!t) {
      return `
        <div class="torvant-panel panel-${level}" role="group" aria-label="Torvant card">
          <div class="torvant-level level-${level}">${riskLevelLabel(level)}</div>
          <div class="torvant-text">Card text not generated yet</div>
        </div>`;
    }
    const fits = t.fits_task === "yes" ? "Yes" : "No";
    const undo = { yes: "Yes", no: "No", partly: "Partly" }[t.can_be_undone] || escapeHtml(t.can_be_undone);
    const raised = t.raised_by_model ? `<div class="torvant-note">Level raised by Gemini</div>` : "";
    return `
      <div class="torvant-panel panel-${level}" role="group" aria-label="Torvant card">
        <div class="torvant-level level-${level}">${riskLevelLabel(level)}</div>
        ${raised}
        <dl class="torvant-facts">
          <dt>What it does</dt><dd>${escapeHtml(t.what_it_does)}</dd>
          <dt>Fits the task?</dt><dd><strong>${fits}</strong>. ${escapeHtml(t.fits_task_why)}</dd>
          <dt>Reach</dt><dd>${escapeHtml(t.reach)}</dd>
          <dt>Touches</dt><dd>${(t.touches || []).map(escapeHtml).join(", ")}</dd>
          <dt>Can be undone</dt><dd>${undo}</dd>
        </dl>
      </div>
    `;
  }

  // Screen 2: Play Screen
  function renderPlayScreen() {
    if (currentCardIndex >= currentCards.length) {
      if (roundTimer) { clearInterval(roundTimer); roundTimer = null; }
      finishRound();
      return;
    }

    const card = currentCards[currentCardIndex];
    const roundName = drillData[currentRoundKey].name || currentRoundKey;
    const progressText = PlayHelpers.progressText(currentCardIndex + 1, currentCards.length);
    const progressBar = PlayHelpers.progressBar(currentCardIndex + 1, currentCards.length);
    const torvantSection = currentCardVariant === "torvant" ? buildTorvantSection(card) : "";
    const commandOf = (id) => (currentCards.find((c) => c.id === id) || {}).command || "";
    const history = PlayHelpers.historyLines(
      roundDecisions.slice(-2).map((d) => ({ decision: d.decision, command: commandOf(d.cardId) }))
    );

    container.innerHTML = `
      <h1 class="sr-only">Torvant Drill: ${escapeHtml(variantTitle(currentCardVariant))}</h1>
      <div class="status-bar">
        <span class="badge-progress">
          ${progressText}<span class="sr-only"> in ${escapeHtml(roundName)}</span> <span class="progress-bar" aria-hidden="true">${progressBar}</span>
        </span>
        <span id="roundTimer" class="badge-timer ${roundSecondsLeft <= 15 ? 'urgent' : ''}">
          <span class="sr-only">Time left </span><span id="timerNum">${roundSecondsLeft}s</span>
        </span>
      </div>

      <div class="term-history" role="group" aria-label="Your last answers">
        ${history.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
      </div>

      <div class="request-card">
        <div>
          <div class="label-title">Task</div>
          <h2 class="task-box" id="taskHeading" tabindex="-1">${escapeHtml(card.task)}</h2>
        </div>

        ${torvantSection}

        <div>
          <div class="label-title">The agent wants to run</div>
          <pre class="command-box ${torvantSection ? "command-small" : ""}"><code>${escapeHtml(card.command)}</code></pre>
        </div>
      </div>

      <div class="thumb-actions play-actions">
        <button id="denyBtn" class="btn-large btn-deny" aria-label="Deny this request">
          Deny
        </button>
        <button id="approveBtn" class="btn-large btn-approve" aria-label="Approve this request">
          Approve
        </button>
      </div>
    `;

    document.getElementById("denyBtn").addEventListener("click", () => {
      if (tapGuard.tryTake()) handleDecision("denied");
    });
    document.getElementById("approveBtn").addEventListener("click", () => {
      if (!tapGuard.tryTake()) return;
      if (currentCardVariant === "torvant" && card.level === "high") {
        renderHighConfirm();
      } else {
        handleDecision("approved");
      }
    });

    // Every new card starts at the top, and taps are locked for its first moment.
    window.scrollTo(0, 0);
    tapGuard.cardShown();
    focusFirst("#taskHeading");
    announce(`${progressText}`);

    // Timing fix: start round clock and per-card timer ONLY after the first card is shown in the DOM
    cardStartTime = performance.now();
    if (currentCardIndex === 0 && !roundTimer) {
      startRoundTimer();
    }
  }

  // Second confirm before approving a High risk request (Torvant card only).
  // The per-card timer keeps running, so the pause counts in decision time.
  function renderHighConfirm() {
    const actions = container.querySelector(".thumb-actions");
    if (!actions) return;
    actions.innerHTML = `
      <div class="confirm-box" role="alertdialog" aria-labelledby="confirmText">
        <p class="confirm-text" id="confirmText">This is high risk. Approve anyway?</p>
        <button id="goBackBtn" class="btn-large btn-deny" aria-label="Go back to the request">Go back</button>
        <button id="confirmApproveBtn" class="btn-large btn-approve" aria-label="Yes, approve anyway">Yes, approve</button>
      </div>`;
    const goBack = () => {
      const keep = cardStartTime;
      renderPlayScreen();
      cardStartTime = keep;
    };
    document.getElementById("goBackBtn").addEventListener("click", goBack);
    actions.querySelector(".confirm-box").addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); goBack(); }
    });
    document.getElementById("confirmApproveBtn").addEventListener("click", () => {
      if (tapGuard.tryTake()) handleDecision("approved");
    });
    tapGuard.cardShown();
    document.getElementById("goBackBtn").focus({ preventScroll: true });
  }

  function handleDecision(decision) {
    const elapsedSeconds = Number(((performance.now() - cardStartTime) / 1000).toFixed(1));
    const card = currentCards[currentCardIndex];

    roundDecisions.push({ cardId: card.id, decision: decision, secondsTaken: elapsedSeconds });
    postDecisionToBigQuery(card, decision, elapsedSeconds, true, currentCardIndex);

    currentCardIndex++;
    renderPlayScreen();
  }

  // Finish round and get server scoring
  async function finishRound() {
    if (roundTimer) { clearInterval(roundTimer); roundTimer = null; }

    container.innerHTML = `<p class="lead-text">Calculating score...</p>`;

    try {
      const res = await fetch("/api/drill/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundKey: currentRoundId(), decisions: roundDecisions })
      });

      const score = await res.json();
      score.cardVariant = currentCardVariant;

      if (currentRoundKey === "roundA") roundAScore = score;
      else roundBScore = score;

      renderScoreScreen(score);
    } catch (err) {
      container.innerHTML = `<p class="info-note">Error calculating score: ${err.message}</p>`;
    }
  }

  // Screen 3: Score Screen
  function renderScoreScreen(score) {
    let ratingClass = "rating-good";
    if (score.overallRating.includes("Poor") || score.overallRating.includes("Missed")) {
      ratingClass = "rating-poor";
    } else if (score.overallRating === "Excellent") {
      ratingClass = "rating-excellent";
    } else if (score.overallRating === "Needs Attention") {
      ratingClass = "rating-attention";
    }

    let riskyCardsHtml = "";
    // Risky requests the player approved come first.
    const missedFirst = score.riskyBreakdown
      .map((item, i) => ({ item, i }))
      .sort((a, b) => (b.item.decision === "approved") - (a.item.decision === "approved") || a.i - b.i)
      .map((x) => x.item);
    missedFirst.forEach((item) => {
      const statusSymbol = item.caught ? "Caught" : "Missed";
      const itemClass = item.caught ? "caught" : "missed";
      riskyCardsHtml += `
        <div class="risky-item ${itemClass}">
          <div><strong>Task:</strong> ${escapeHtml(item.task)}</div>
          <div><pre class="command-box"><code>${escapeHtml(item.command)}</code></pre></div>
          <div class="choice-badge">
            Your decision: ${formatChoice(item.decision)} &nbsp; <strong>${statusSymbol}</strong>
          </div>
          ${item.decision === "approved" ? `<h4 class="if-real">If this were real</h4>` : ""}
          <div class="explanation-text">
            <strong>Why a careful person denies it:</strong><br>
            ${escapeHtml(item.denialReason)}
          </div>
          ${item.decision === "approved" ? explainButton(item.cardId) : ""}
        </div>
      `;
    });

    let blockedHtml = "";
    (score.wronglyBlockedCards || []).forEach((item) => {
      blockedHtml += `
        <div class="risky-item missed">
          <div><strong>Task:</strong> ${escapeHtml(item.task)}</div>
          <div><pre class="command-box"><code>${escapeHtml(item.command)}</code></pre></div>
          <div class="choice-badge">Your decision: ${formatChoice("denied")} &nbsp; <strong>Normal request</strong></div>
          ${explainButton(item.cardId)}
        </div>
      `;
    });

    // After round 1 (playIndex 0), there is a second round to play
    const isFirstPlay = playIndex === 0;
    const nextButtonLabel = isFirstPlay ? "Next: round 2" : "See the summary";

    container.innerHTML = `
      <h1 class="sr-only">Torvant Drill: your score</h1>
      <h2 id="screenHeading" tabindex="-1">${escapeHtml(variantTitle(score.cardVariant))}</h2>

      <div class="stats">
        <div class="stat"><span class="stat-num">${score.riskyCaught} of ${score.totalRisky}</span><span class="stat-label">Risky requests caught</span></div>
        <div class="stat"><span class="stat-num">${score.wronglyBlocked} of ${score.totalNormal}</span><span class="stat-label">Normal requests wrongly blocked</span></div>
        <div class="stat"><span class="stat-num">${score.avgSecondsPerDecision}s</span><span class="stat-label">Per decision</span></div>
        ${score.notReached > 0 ? `<div class="stat"><span class="stat-num">${score.notReached}</span><span class="stat-label">Not reached in 75s</span></div>` : ""}
      </div>
      <p class="score-rating ${ratingClass}">Result: ${escapeHtml(score.overallRating)}</p>

      <h3>Planted risky requests</h3>
      <div class="risky-list">
        ${riskyCardsHtml}
      </div>
      ${blockedHtml ? `<h3>Normal requests you blocked</h3><div class="risky-list">${blockedHtml}</div>` : ""}

      <div class="thumb-actions">
        <button id="nextRoundBtn" class="btn-large btn-primary" aria-label="${nextButtonLabel}">
          ${nextButtonLabel}
        </button>
      </div>
    `;

    wireExplainButtons();
    window.scrollTo(0, 0);
    focusFirst("#screenHeading");

    document.getElementById("nextRoundBtn").addEventListener("click", () => {
      if (isFirstPlay) {
        // Advance to the second round with the other variant
        playIndex = 1;
        currentRoundKey = roundOrder[1];
        currentCardVariant = variantOrder[1];
        startRound();
      } else {
        renderComparisonScreen();
      }
    });
  }

  // Screen 4: After Round Two - Comparison Side by Side with Link to /team
  function renderComparisonScreen() {
    // Always display Round A on the left and Round B on the right
    const scoreA = roundAScore;
    const scoreB = roundBScore;

    container.innerHTML = `
      <h1 class="sr-only">Torvant Drill: summary</h1>
      <h2 id="screenHeading" tabindex="-1">Drill summary</h2>
      <p class="lead-text">One round used the plain card. The other used the Torvant card. Order is random for each player.</p>
      <p class="lead-text">Session ID: ${playerId}</p>

      <div class="comparison-grid">
        <div class="round-card">
          <h3>${escapeHtml(variantTitle(scoreA.cardVariant))}</h3>
          <div class="stats">
            <div class="stat"><span class="stat-num">${scoreA.riskyCaught} of ${scoreA.totalRisky}</span><span class="stat-label">Risky caught</span></div>
            <div class="stat"><span class="stat-num">${scoreA.wronglyBlocked} of ${scoreA.totalNormal}</span><span class="stat-label">Wrongly blocked</span></div>
            <div class="stat"><span class="stat-num">${scoreA.avgSecondsPerDecision}s</span><span class="stat-label">Per decision</span></div>
          </div>
          <p class="score-rating">Result: ${escapeHtml(scoreA.overallRating)}</p>
        </div>

        <div class="round-card">
          <h3>${escapeHtml(variantTitle(scoreB.cardVariant))}</h3>
          <div class="stats">
            <div class="stat"><span class="stat-num">${scoreB.riskyCaught} of ${scoreB.totalRisky}</span><span class="stat-label">Risky caught</span></div>
            <div class="stat"><span class="stat-num">${scoreB.wronglyBlocked} of ${scoreB.totalNormal}</span><span class="stat-label">Wrongly blocked</span></div>
            <div class="stat"><span class="stat-num">${scoreB.avgSecondsPerDecision}s</span><span class="stat-label">Per decision</span></div>
          </div>
          <p class="score-rating">Result: ${escapeHtml(scoreB.overallRating)}</p>
        </div>
      </div>

      <section class="questions" id="questions" aria-label="Two optional questions">
        <h3>Two optional questions</h3>
        <p class="q-text" id="qText1">On a normal work day, how many agent requests do you approve?</p>
        <div class="q-options" data-q="approvals_per_day" role="group" aria-labelledby="qText1">
          ${["None", "1 to 10", "11 to 50", "More than 50"].map((o) => `<button type="button" class="q-opt" aria-pressed="false">${o}</button>`).join("")}
        </div>
        <p class="q-text" id="qText2">How many of them do you read fully?</p>
        <div class="q-options" data-q="read_share" role="group" aria-labelledby="qText2">
          ${["All", "Most", "Some", "Almost none"].map((o) => `<button type="button" class="q-opt" aria-pressed="false">${o}</button>`).join("")}
        </div>
        <div class="q-actions">
          <button type="button" id="qSend" class="btn-large btn-primary" disabled aria-label="Send answers">Send answers</button>
          <button type="button" id="qSkip" class="btn-explain" aria-label="Skip the questions">Skip</button>
        </div>
      </section>

      <div class="info-note">
        <strong>Drill Takeaway:</strong> High-performing reviewers balance spotting critical security risks without indiscriminately blocking safe developer actions.
      </div>

      <p class="lead-text">For any team whose developers use coding agents. The team report is what a security lead gets.</p>

      <div class="thumb-actions">
        <a href="/team" class="btn-large btn-primary" aria-label="View Team Results">
          View team results
        </a>
        <a href="/how" class="btn-large" aria-label="How it works">
          How it works
        </a>
        <button id="restartBtn" class="btn-large" aria-label="Play Again">
          Play again
        </button>
      </div>
    `;

    document.getElementById("restartBtn").addEventListener("click", () => {
      location.reload();
    });
    wireQuestions();
    window.scrollTo(0, 0);
    focusFirst("#screenHeading");
  }

  // "Explain with Gemini (live)": calls Gemini now, with a timeout on the server.
  // If the live call fails, times out or hits the limit, the stored answer is shown.
  function explainButton(cardId) {
    return `
      <div class="explain-block">
        <button class="btn-explain" data-card="${escapeHtml(cardId)}">
          Explain with Gemini (live)
        </button>
        <div class="explain-out" aria-live="polite"></div>
      </div>`;
  }

  function wireExplainButtons() {
    container.querySelectorAll(".btn-explain").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const out = btn.nextElementSibling;
        btn.disabled = true;
        out.textContent = "Asking Gemini...";
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 20000);
          const res = await fetch("/api/explain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardId: btn.dataset.card }),
            signal: ctrl.signal
          });
          clearTimeout(timer);
          const data = await res.json();
          out.innerHTML = renderExplanation(data);
        } catch (_) {
          out.textContent = "Gemini did not answer in time. Try again later.";
        }
        btn.disabled = false;
      });
    });
  }

  function renderExplanation(data) {
    const t = data && data.text;
    if (!t) return "No explanation available yet.";
    const label = data.source === "live"
      ? `Live from ${escapeHtml(data.model)}`
      : `Stored answer${data.model ? " from " + escapeHtml(data.model) : ""}`;
    return `
      <div class="explain-card">
        <div class="explain-source">${label}</div>
        <div><strong>${riskLevelLabel(t.risk_level)}</strong></div>
        <div><strong>What it does:</strong> ${escapeHtml(t.what_it_does)}</div>
        <div><strong>Fits the task?</strong> ${t.fits_task === "yes" ? "Yes" : "No"}. ${escapeHtml(t.fits_task_why)}</div>
        <div><strong>Reach:</strong> ${escapeHtml(t.reach)}</div>
      </div>`;
  }

  // Optional questions. Sending never waits and never breaks the screen.
  function wireQuestions() {
    const box = document.getElementById("questions");
    if (!box) return;
    const answers = {};
    const send = document.getElementById("qSend");
    box.querySelectorAll(".q-options").forEach((group) => {
      group.querySelectorAll(".q-opt").forEach((opt) => {
        opt.addEventListener("click", () => {
          group.querySelectorAll(".q-opt").forEach((o) => o.setAttribute("aria-pressed", "false"));
          opt.setAttribute("aria-pressed", "true");
          answers[group.dataset.q] = opt.textContent.trim();
          send.disabled = false;
        });
      });
    });
    send.addEventListener("click", () => {
      try {
        fetch("/api/answers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ play_id: playId, player_id: playerId }, answers)),
          keepalive: true
        }).catch(() => {});
      } catch (_) {}
      box.innerHTML = `<p class="info-note" id="qThanks" tabindex="-1">Thank you.</p>`;
      document.getElementById("qThanks").focus();
    });
    document.getElementById("qSkip").addEventListener("click", () => {
      box.remove();
      const next = container.querySelector(".thumb-actions a");
      if (next) next.focus();
    });
  }

  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initial load
  renderStartScreen();
})();
