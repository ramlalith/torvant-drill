// Torvant Drill - Phone-First Application Flow
(function () {
  // Generate random player ID and play ID (no names, emails, or IP addresses stored)
  const playerId = "drill-" + Math.random().toString(36).substring(2, 10);
  const playId = "play-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 6);

  let drillData = null;
  let currentRoundKey = "roundA"; // 'roundA' then 'roundB'
  let currentCardIndex = 0;
  let currentCards = [];
  let roundDecisions = [];
  let roundTimer = null;
  let roundSecondsLeft = 75;
  let cardStartTime = 0;

  let roundAScore = null;
  let roundBScore = null;

  // DOM Container
  const container = document.getElementById("app");

  // Format decision text with symbol (never color alone)
  function formatChoice(decision) {
    if (decision === "denied") {
      return "🛑 Denied";
    }
    if (decision === "approved") {
      return "✓ Approved";
    }
    return "⏳ Not Reached (Time Expired)";
  }

  // Asynchronously record decision to BigQuery endpoint (non-blocking)
  function postDecisionToBigQuery(card, decision, seconds, reached, queueIndex) {
    const payload = {
      play_id: playId,
      player_id: playerId,
      ts: new Date().toISOString(),
      round: drillData && drillData[currentRoundKey] ? drillData[currentRoundKey].name : currentRoundKey,
      card_variant: "plain",
      queue_id: String(queueIndex + 1),
      card_id: card.id,
      risky: Boolean(card.isRisky),
      risk_type: card.risk_type || null,
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

  // Screen 1: Start Screen
  function renderStartScreen() {
    container.innerHTML = `
      <h1>Torvant Drill</h1>
      <p class="lead-text">AI agents ask a person before risky actions. Can you spot the risky ones?</p>
      
      <div class="info-note">
        <strong>Drill Details:</strong><br>
        8 requests, about 60 seconds.<br>
        Some requests are planted tests.<br>
        Nothing here is ever run.<br>
        No names are stored.<br>
        <br>
        <em>Your Session ID: ${playerId}</em>
      </div>

      <div class="thumb-actions">
        <button id="startBtn" class="btn-large btn-primary" aria-label="Start Torvant Drill">
          ▶ Start Drill
        </button>
      </div>
    `;

    document.getElementById("startBtn").addEventListener("click", startDrill);
  }

  // Load drill data from server
  async function startDrill() {
    try {
      container.innerHTML = `<p class="lead-text">Loading drill requests...</p>`;
      const res = await fetch("/api/drill/rounds");
      if (!res.ok) {
        throw new Error("Failed to load drill data from server.");
      }
      drillData = await res.json();
      currentRoundKey = "roundA";
      startRound(currentRoundKey);
    } catch (err) {
      container.innerHTML = `
        <h2>Error Loading Drill</h2>
        <p class="info-note">${err.message}</p>
        <div class="thumb-actions">
          <button class="btn-large btn-primary" onclick="location.reload()" aria-label="Retry loading">
            🔄 Retry
          </button>
        </div>
      `;
    }
  }

  // Prepare a specific round (does NOT start timers until first card is shown)
  function startRound(roundKey) {
    if (roundTimer) {
      clearInterval(roundTimer);
      roundTimer = null;
    }
    currentRoundKey = roundKey;
    currentCards = drillData[roundKey].cards;
    currentCardIndex = 0;
    roundDecisions = [];
    roundSecondsLeft = 75;

    // Render the first card. Timer will start only after first card is inserted in DOM.
    renderPlayScreen();
  }

  // Timer logic for the round
  function startRoundTimer() {
    if (roundTimer) {
      clearInterval(roundTimer);
    }

    roundTimer = setInterval(() => {
      roundSecondsLeft--;
      const timerEl = document.getElementById("roundTimer");
      if (timerEl) {
        timerEl.textContent = `⏱ ${roundSecondsLeft}s`;
        if (roundSecondsLeft <= 15) {
          timerEl.classList.add("urgent");
        }
      }

      if (roundSecondsLeft <= 0) {
        clearInterval(roundTimer);
        roundTimer = null;
        handleTimeExpired();
      }
    }, 1000);
  }

  // When timer runs out, mark remaining as "not reached"
  async function handleTimeExpired() {
    while (currentCardIndex < currentCards.length) {
      const card = currentCards[currentCardIndex];
      roundDecisions.push({
        cardId: card.id,
        decision: "not reached",
        secondsTaken: 0
      });

      // Stream to BigQuery
      postDecisionToBigQuery(card, "not reached", 0, false, currentCardIndex);
      currentCardIndex++;
    }
    await finishRound();
  }

  // Screen 2: Play Screen
  function renderPlayScreen() {
    if (currentCardIndex >= currentCards.length) {
      if (roundTimer) {
        clearInterval(roundTimer);
        roundTimer = null;
      }
      finishRound();
      return;
    }

    const card = currentCards[currentCardIndex];
    const roundName = drillData[currentRoundKey].name || currentRoundKey;
    const progressText = `${currentCardIndex + 1} of ${currentCards.length}`;

    container.innerHTML = `
      <div class="status-bar">
        <span class="badge-progress" aria-label="Progress: Request ${progressText} in ${roundName}">
          ${roundName}: ${progressText}
        </span>
        <span id="roundTimer" class="badge-timer ${roundSecondsLeft <= 15 ? 'urgent' : ''}" aria-label="Time remaining: ${roundSecondsLeft} seconds">
          ⏱ ${roundSecondsLeft}s
        </span>
      </div>

      <div class="request-card">
        <div>
          <div class="label-title">Task</div>
          <div class="task-box">${escapeHtml(card.task)}</div>
        </div>

        <div>
          <div class="label-title">The agent wants to run</div>
          <pre class="command-box"><code>${escapeHtml(card.command)}</code></pre>
        </div>
      </div>

      <div class="thumb-actions">
        <button id="denyBtn" class="btn-large btn-deny" aria-label="Deny this request">
          🛑 Deny
        </button>
        <button id="approveBtn" class="btn-large btn-approve" aria-label="Approve this request">
          ✓ Approve
        </button>
      </div>
    `;

    document.getElementById("denyBtn").addEventListener("click", () => handleDecision("denied"));
    document.getElementById("approveBtn").addEventListener("click", () => handleDecision("approved"));

    // Timing fix: start round clock and per-card timer ONLY after the first card is shown in the DOM!
    cardStartTime = performance.now();
    if (currentCardIndex === 0 && !roundTimer) {
      startRoundTimer();
    }
  }

  function handleDecision(decision) {
    const elapsedSeconds = Number(((performance.now() - cardStartTime) / 1000).toFixed(1));
    const card = currentCards[currentCardIndex];

    roundDecisions.push({
      cardId: card.id,
      decision: decision,
      secondsTaken: elapsedSeconds
    });

    // Write row to BigQuery (non-blocking)
    postDecisionToBigQuery(card, decision, elapsedSeconds, true, currentCardIndex);

    currentCardIndex++;
    renderPlayScreen();
  }

  // Finish round and get server scoring
  async function finishRound() {
    if (roundTimer) {
      clearInterval(roundTimer);
      roundTimer = null;
    }

    container.innerHTML = `<p class="lead-text">Calculating score...</p>`;

    try {
      const res = await fetch("/api/drill/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundKey: currentRoundKey,
          decisions: roundDecisions
        })
      });

      const score = await res.json();

      if (currentRoundKey === "roundA") {
        roundAScore = score;
      } else {
        roundBScore = score;
      }

      renderScoreScreen(score);
    } catch (err) {
      container.innerHTML = `<p class="info-note">Error calculating score: ${err.message}</p>`;
    }
  }

  // Screen 3: Score Screen
  function renderScoreScreen(score) {
    let ratingClass = "rating-good";
    if (score.overallRating.includes("Poor")) {
      ratingClass = "rating-poor";
    } else if (score.overallRating === "Excellent") {
      ratingClass = "rating-excellent";
    } else if (score.overallRating === "Needs Attention") {
      ratingClass = "rating-attention";
    }

    let riskyCardsHtml = "";
    score.riskyBreakdown.forEach((item) => {
      const statusSymbol = item.caught ? "✓ [CAUGHT]" : "✕ [MISSED]";
      const itemClass = item.caught ? "caught" : "missed";
      riskyCardsHtml += `
        <div class="risky-item ${itemClass}">
          <div><strong>Task:</strong> ${escapeHtml(item.task)}</div>
          <div><pre class="command-box"><code>${escapeHtml(item.command)}</code></pre></div>
          <div class="choice-badge">
            Your decision: ${formatChoice(item.decision)} &nbsp; <strong>${statusSymbol}</strong>
          </div>
          <div class="explanation-text">
            <strong>Why a careful person denies it:</strong><br>
            ${escapeHtml(item.denialReason)}
          </div>
        </div>
      `;
    });

    const isRoundA = currentRoundKey === "roundA";
    const nextButtonLabel = isRoundA ? "Next: Start Round B ▶" : "View Final Comparison ▶";

    container.innerHTML = `
      <h2>${escapeHtml(score.roundName)} Score</h2>

      <div class="score-highlight">
        <div class="score-metric">🎯 You caught ${score.riskyCaught} of ${score.totalRisky} risky requests</div>
        <div class="score-metric">⚠️ You wrongly blocked ${score.wronglyBlocked} of ${score.totalNormal} normal requests</div>
        <div class="score-metric">⚡ ${score.avgSecondsPerDecision} seconds per decision</div>
        ${score.notReached > 0 ? `<div class="score-metric">⏳ ${score.notReached} requests not reached in 75s</div>` : ""}
        <div class="score-rating ${ratingClass}">
          Evaluation: ${escapeHtml(score.overallRating)}
        </div>
      </div>

      <h3>Planted Risky Requests Review:</h3>
      <div class="risky-list">
        ${riskyCardsHtml}
      </div>

      <div class="thumb-actions">
        <button id="nextRoundBtn" class="btn-large btn-primary" aria-label="${nextButtonLabel}">
          ${nextButtonLabel}
        </button>
      </div>
    `;

    document.getElementById("nextRoundBtn").addEventListener("click", () => {
      if (isRoundA) {
        startRound("roundB");
      } else {
        renderComparisonScreen();
      }
    });
  }

  // Screen 4: After Round Two - Comparison Side by Side with Link to /team
  function renderComparisonScreen() {
    container.innerHTML = `
      <h2>Drill Summary: Round A & Round B</h2>
      <p class="lead-text">Session ID: ${playerId}</p>

      <div class="comparison-grid">
        <div class="round-card">
          <h3>${escapeHtml(roundAScore.roundName)}</h3>
          <p><strong>Caught:</strong> ${roundAScore.riskyCaught} / ${roundAScore.totalRisky} risky</p>
          <p><strong>Wrong blocks:</strong> ${roundAScore.wronglyBlocked} / ${roundAScore.totalNormal} normal</p>
          <p><strong>Speed:</strong> ${roundAScore.avgSecondsPerDecision}s / decision</p>
          <p><strong>Result:</strong> ${escapeHtml(roundAScore.overallRating)}</p>
        </div>

        <div class="round-card">
          <h3>${escapeHtml(roundBScore.roundName)}</h3>
          <p><strong>Caught:</strong> ${roundBScore.riskyCaught} / ${roundBScore.totalRisky} risky</p>
          <p><strong>Wrong blocks:</strong> ${roundBScore.wronglyBlocked} / ${roundBScore.totalNormal} normal</p>
          <p><strong>Speed:</strong> ${roundBScore.avgSecondsPerDecision}s / decision</p>
          <p><strong>Result:</strong> ${escapeHtml(roundBScore.overallRating)}</p>
        </div>
      </div>

      <div class="info-note">
        <strong>Drill Takeaway:</strong> High-performing reviewers balance spotting critical security risks without indiscriminately blocking safe developer actions.
      </div>

      <div class="thumb-actions">
        <a href="/team" class="btn-large btn-primary" style="text-decoration: none;" aria-label="View Team Results">
          📊 View Team Results
        </a>
        <button id="restartBtn" class="btn-large btn-primary" style="background: #475569; border-color: #334155;" aria-label="Play Again">
          🔄 Play Again
        </button>
      </div>
    `;

    document.getElementById("restartBtn").addEventListener("click", () => {
      location.reload();
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
