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
  let cardTextMap = {}; // keyed by card_id, populated from data/card_text.json if available
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

  // DOM Container
  const container = document.getElementById("app");

  // Format decision text with symbol (never color alone)
  function formatChoice(decision) {
    if (decision === "denied") return "🛑 Denied";
    if (decision === "approved") return "✓ Approved";
    return "⏳ Not Reached (Time Expired)";
  }

  // Map risk level to a human-readable badge label (text + symbol, never color alone)
  function riskLevelLabel(level) {
    if (level === "high") return "⛔ HIGH RISK";
    if (level === "medium") return "⚠️ MEDIUM RISK";
    return "ℹ️ LOW RISK";
  }

  // Round letter for queue_id: "A" or "B"
  function roundLetter(roundKey) {
    return roundKey === "roundA" ? "A" : "B";
  }

  // Asynchronously record decision to BigQuery endpoint (non-blocking)
  function postDecisionToBigQuery(card, decision, seconds, reached, positionIndex) {
    const payload = {
      play_id: playId,
      player_id: playerId,
      ts: new Date().toISOString(),
      round: drillData && drillData[currentRoundKey] ? drillData[currentRoundKey].name : currentRoundKey,
      card_variant: currentCardVariant,
      queue_id: roundLetter(currentRoundKey),   // "A" or "B"
      position: positionIndex + 1,              // 1-based position within the round
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

  // Load drill data and card_text.json from server
  async function startDrill() {
    try {
      container.innerHTML = `<p class="lead-text">Loading drill requests...</p>`;
      const res = await fetch("/api/drill/rounds");
      if (!res.ok) {
        throw new Error("Failed to load drill data from server.");
      }
      drillData = await res.json();

      // Try to load card_text.json (gracefully ignore 404 or parse errors)
      try {
        const ctRes = await fetch("/data/card_text.json");
        if (ctRes.ok) {
          cardTextMap = await ctRes.json();
        }
      } catch (_) {
        cardTextMap = {};
      }

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
            🔄 Retry
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
      if (timerEl) {
        timerEl.textContent = `⏱ ${roundSecondsLeft}s`;
        if (roundSecondsLeft <= 15) timerEl.classList.add("urgent");
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
      roundDecisions.push({ cardId: card.id, decision: "not reached", secondsTaken: 0 });
      postDecisionToBigQuery(card, "not reached", 0, false, currentCardIndex);
      currentCardIndex++;
    }
    await finishRound();
  }

  // Build the Torvant card section (risk badge + card text or placeholder)
  function buildTorvantSection(card) {
    const analysis = card.riskAnalysis || { flags: [], level: "low" };
    const levelLabel = riskLevelLabel(analysis.level);
    const cardText = cardTextMap && cardTextMap[card.id]
      ? escapeHtml(cardTextMap[card.id])
      : "Card text not generated yet";
    const flagsText = analysis.flags.length > 0
      ? analysis.flags.map(f => escapeHtml(f)).join(", ")
      : "none";

    return `
      <div class="torvant-panel" aria-label="Torvant risk analysis panel">
        <div class="torvant-level" aria-label="Risk level: ${analysis.level}">
          ${levelLabel}
        </div>
        <div class="torvant-flags" aria-label="Risk flags: ${flagsText}">
          <strong>Flags:</strong> ${flagsText}
        </div>
        <div class="torvant-text">${cardText}</div>
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
    const progressText = `${currentCardIndex + 1} of ${currentCards.length}`;
    const torvantSection = currentCardVariant === "torvant" ? buildTorvantSection(card) : "";

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

        ${torvantSection}
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

    // Timing fix: start round clock and per-card timer ONLY after the first card is shown in the DOM
    cardStartTime = performance.now();
    if (currentCardIndex === 0 && !roundTimer) {
      startRoundTimer();
    }
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
        body: JSON.stringify({ roundKey: currentRoundKey, decisions: roundDecisions })
      });

      const score = await res.json();

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

    // After round 1 (playIndex 0), there is a second round to play
    const isFirstPlay = playIndex === 0;
    const nextButtonLabel = isFirstPlay ? "Next: Start Round 2 ▶" : "View Final Comparison ▶";

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
      <h2>Drill Summary: Round A &amp; Round B</h2>
      <p class="lead-text">Session ID: ${playerId}</p>

      <div class="comparison-grid">
        <div class="round-card">
          <h3>${escapeHtml(scoreA.roundName)}</h3>
          <p><strong>Caught:</strong> ${scoreA.riskyCaught} / ${scoreA.totalRisky} risky</p>
          <p><strong>Wrong blocks:</strong> ${scoreA.wronglyBlocked} / ${scoreA.totalNormal} normal</p>
          <p><strong>Speed:</strong> ${scoreA.avgSecondsPerDecision}s / decision</p>
          <p><strong>Result:</strong> ${escapeHtml(scoreA.overallRating)}</p>
        </div>

        <div class="round-card">
          <h3>${escapeHtml(scoreB.roundName)}</h3>
          <p><strong>Caught:</strong> ${scoreB.riskyCaught} / ${scoreB.totalRisky} risky</p>
          <p><strong>Wrong blocks:</strong> ${scoreB.wronglyBlocked} / ${scoreB.totalNormal} normal</p>
          <p><strong>Speed:</strong> ${scoreB.avgSecondsPerDecision}s / decision</p>
          <p><strong>Result:</strong> ${escapeHtml(scoreB.overallRating)}</p>
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
