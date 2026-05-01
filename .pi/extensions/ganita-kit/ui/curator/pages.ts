/**
 * Generate the HTML page for the search curator UI.
 * This is the interactive browser interface where users review,
 * select, and approve search results.
 */

function safeInlineJSON(data: unknown): string {
	return JSON.stringify(data)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

function buildProviderButtons(defaultProvider: string): string {
	const providers = [{ value: "exa", label: "Exa" }];

	return providers
		.map((p) => {
			const isDefault = p.value === defaultProvider;
			const classes = ["provider-btn", "idle", isDefault ? "is-default" : ""]
				.filter(Boolean)
				.join(" ");
			return `<button type="button" class="${classes}" data-provider="${p.value}" data-state="idle">${p.label}</button>`;
		})
		.join("");
}

export function generateCuratorPage(
	queries: string[],
	sessionToken: string,
	timeout: number,
	defaultProvider: string,
): string {
	const providerButtonsHtml = buildProviderButtons(defaultProvider);
	const inlineData = safeInlineJSON({
		queries,
		sessionToken,
		timeout,
		defaultProvider,
	});

	return `
    <!doctype html>
    <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Curate Search Results</title>
            <style>
                ${CSS}
            </style>
        </head>
        <body>
            <div class="timer-badge" id="timer" title="Click to adjust">--:--</div>
            <main>
                <div class="hero" id="hero">
                    <div class="hero-kicker">Web Search</div>
                    <h1 class="hero-title">Searching\u2026</h1>
                    <p class="hero-desc">
                        Results will appear below as they complete.
                    </p>
                    <div class="hero-meta">
                        <span id="hero-status">Searching\u2026</span>
                        <span class="hero-meta-sep"></span>
                        <div class="provider-buttons" id="provider-buttons">
                            ${providerButtonsHtml}
                        </div>
                    </div>
                </div>
                <div id="result-cards"></div>

                <div class="add-search" id="add-search">
                    <span class="add-search-icon">+</span>
                    <input
                        type="text"
                        placeholder="Add a search\u2026"
                        id="add-search-input"
                    />
                </div>
                <section
                    class="summary-panel hidden"
                    id="summary-panel"
                    aria-label="Summary review"
                >
                    <div class="summary-header">
                        <div class="summary-header-top">
                            <h2 class="summary-title">Review summary draft</h2>
                        </div>
                    </div>
                    <div
                        class="summary-generating hidden"
                        id="summary-generating"
                        aria-live="polite"
                    >
                        <div class="summary-generating-head">
                            <span id="summary-generating-copy"
                                >Generating summary draft\u2026</span
                            >
                        </div>
                    </div>
                    <textarea
                        id="summary-input"
                        class="summary-input"
                        placeholder="Summary draft will appear here\u2026"
                    ></textarea>
                    <div class="summary-actions">
                        <button class="btn btn-secondary" id="btn-summary-back">
                            Back
                        </button>
                        <button
                            class="btn btn-secondary"
                            id="btn-summary-regenerate"
                        >
                            Regenerate
                        </button>
                        <button class="btn btn-submit" id="btn-summary-approve">
                            Approve
                        </button>
                    </div>
                </section>
            </main>
            <footer class="action-bar">
                <div class="action-buttons">
                    <button class="btn btn-submit" id="btn-send" disabled>
                        Waiting for results\u2026
                    </button>
                </div>
            </footer>
            <div
                id="success-overlay"
                class="success-overlay hidden"
                aria-live="polite"
            >
                <div class="success-icon">OK</div>
                <p>Results sent</p>
            </div>
            <div
                id="expired-overlay"
                class="expired-overlay hidden"
                aria-live="polite"
            >
                <div class="expired-content">
                    <div class="expired-icon">!</div>
                    <h2>Session Ended</h2>
                    <p>Time\u2019s up \u2014 sending all results to your agent.</p>
                </div>
            </div>
            <script>
                ${SCRIPT.replace("__INLINE_DATA__", () => inlineData)}
            </script>
        </body>
    </html>
`;
}

// ── CSS ────────────────────────────────────────────────────

const CSS = `
    *,
    *::before,
    *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }
    :root {
        --bg: #18181e;
        --bg-card: #1e1e24;
        --bg-elevated: #252530;
        --bg-hover: #2b2b37;
        --fg: #e0e0e0;
        --fg-muted: #909098;
        --fg-dim: #606068;
        --accent: #8abeb7;
        --accent-hover: #9dcec7;
        --accent-muted: rgba(138, 190, 183, 0.15);
        --border: #2a2a34;
        --border-muted: #353540;
        --btn-primary: #8abeb7;
        --btn-primary-hover: #9dcec7;
        --btn-primary-fg: #18181e;
        --btn-secondary: #252530;
        --btn-secondary-hover: #2b2b37;
        --success: #b5bd68;
        --warning: #f0c674;
        --font: system-ui, -apple-system, sans-serif;
        --radius: 10px;
        --radius-sm: 6px;
    }
    @media (prefers-color-scheme: light) {
        :root {
            --bg: #f5f5f7;
            --bg-card: #fff;
            --bg-elevated: #eeeef0;
            --bg-hover: #e4e4e8;
            --fg: #1a1a1e;
            --fg-muted: #6c6c74;
            --fg-dim: #9a9aa2;
            --accent: #5f8787;
            --accent-hover: #4a7272;
            --accent-muted: rgba(95, 135, 135, 0.12);
            --border: #dcdce0;
            --border-muted: #c8c8d0;
            --btn-primary: #5f8787;
            --btn-primary-hover: #4a7272;
            --btn-primary-fg: #fff;
            --btn-secondary: #e4e4e8;
            --btn-secondary-hover: #d4d4d8;
            --success: #4d7c0f;
            --warning: #b45309;
        }
    }
    body {
        font-family: var(--font);
        background: var(--bg);
        color: var(--fg);
        line-height: 1.5;
        min-height: 100dvh;
        padding-bottom: 72px;
        margin: 0;
    }
    .timer-badge {
        position: fixed;
        top: 20px;
        right: 24px;
        z-index: 50;
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        padding: 5px 14px;
        border-radius: 999px;
        background: var(--bg-elevated);
        color: var(--fg-muted);
        border: 1px solid var(--border);
        cursor: pointer;
        user-select: none;
        opacity: 0.5;
        transition: opacity 0.3s;
    }
    .timer-badge:hover {
        opacity: 1;
    }
    .timer-badge.warn {
        background: rgba(240, 198, 116, 0.15);
        color: #f0c674;
        opacity: 1;
    }
    .timer-badge.urgent {
        background: rgba(204, 102, 102, 0.15);
        color: #cc6666;
        opacity: 1;
    }
    .hero {
        padding: 40px 24px 24px;
        text-align: center;
    }
    .hero-kicker {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--fg-muted);
        margin-bottom: 8px;
    }
    .hero-title {
        font-size: 28px;
        font-weight: 700;
        color: var(--fg);
        margin-bottom: 4px;
    }
    .hero-desc {
        font-size: 14px;
        color: var(--fg-muted);
        margin-bottom: 20px;
    }
    .hero-meta {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        font-size: 13px;
        color: var(--fg-muted);
    }
    .hero-meta-sep {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--fg-dim);
    }
    .provider-buttons {
        display: flex;
        gap: 6px;
    }
    .provider-btn {
        padding: 4px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--bg-card);
        color: var(--fg-muted);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
    }
    .provider-btn:hover {
        border-color: var(--accent);
        color: var(--accent);
    }
    .provider-btn.is-default {
        background: var(--accent-muted);
        color: var(--accent);
        border-color: var(--accent);
    }
    #result-cards {
        max-width: 720px;
        margin: 0 auto 24px;
        padding: 0 16px;
    }
    .add-search {
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 720px;
        margin: 0 auto 24px;
        padding: 0 16px;
    }
    .add-search-icon {
        font-size: 20px;
        color: var(--fg-dim);
        flex-shrink: 0;
    }
    .add-search input {
        flex: 1;
        padding: 12px 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg-card);
        color: var(--fg);
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
    }
    .add-search input:focus {
        border-color: var(--accent);
    }
    .summary-panel {
        max-width: 720px;
        margin: 0 auto 24px;
        padding: 0 16px;
        display: block;
    }
    .summary-panel.hidden {
        display: none;
    }
    .summary-header {
        padding: 16px 0;
    }
    .summary-title {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 4px;
    }
    .summary-input {
        width: 100%;
        min-height: 200px;
        padding: 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg-card);
        color: var(--fg);
        font-size: 14px;
        font-family: var(--font);
        resize: vertical;
        outline: none;
        transition: border-color 0.2s;
    }
    .summary-input:focus {
        border-color: var(--accent);
    }
    .summary-generating {
        padding: 40px 0;
        text-align: center;
    }
    .summary-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        padding: 12px 0;
    }
    .btn {
        padding: 10px 20px;
        border: none;
        border-radius: var(--radius-sm);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }
    .btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .btn-submit {
        background: var(--btn-primary);
        color: var(--btn-primary-fg);
    }
    .btn-submit:hover:not(:disabled) {
        background: var(--btn-primary-hover);
    }
    .btn-secondary {
        background: var(--btn-secondary);
        color: var(--fg);
    }
    .btn-secondary:hover:not(:disabled) {
        background: var(--btn-secondary-hover);
    }
    .action-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        display: flex;
        justify-content: flex-end;
        padding: 12px 24px;
        background: var(--bg);
        border-top: 1px solid var(--border);
        z-index: 40;
    }
    .success-overlay,
    .expired-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(24, 24, 30, 0.92);
        z-index: 100;
        flex-direction: column;
        gap: 12px;
        text-align: center;
    }
    .success-overlay.hidden,
    .expired-overlay.hidden {
        display: none;
    }
    .success-icon {
        font-size: 36px;
        font-weight: 700;
        color: var(--success);
        border: 3px solid var(--success);
        width: 64px;
        height: 64px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .expired-icon {
        font-size: 36px;
        color: var(--warning);
        border: 3px solid var(--warning);
        width: 64px;
        height: 64px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .error-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        padding: 12px 24px;
        background: rgba(204, 102, 102, 0.15);
        color: #cc6666;
        font-size: 14px;
        z-index: 200;
    }
    .result-card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 16px;
        margin-bottom: 12px;
        cursor: pointer;
        transition: all 0.2s;
    }
    .result-card:hover {
        background: var(--bg-hover);
    }
    .result-card.selected {
        border-color: var(--accent);
        background: var(--accent-muted);
    }
    .result-card-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
    }
    .result-card-check {
        width: 20px;
        height: 20px;
        border: 2px solid var(--border-muted);
        border-radius: 4px;
        flex-shrink: 0;
        margin-top: 2px;
        transition: all 0.2s;
    }
    .result-card.selected .result-card-check {
        background: var(--accent);
        border-color: var(--accent);
    }
    .result-card-check.checked::after {
        content: "\\2713";
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--btn-primary-fg);
        font-size: 12px;
        font-weight: 700;
    }
    .result-card-query {
        font-size: 14px;
        font-weight: 600;
        color: var(--fg);
        margin-bottom: 4px;
    }
    .result-card-provider {
        font-size: 11px;
        color: var(--fg-dim);
        margin-bottom: 8px;
    }
    .result-card-answer {
        font-size: 13px;
        color: var(--fg-muted);
        line-height: 1.6;
        margin-bottom: 8px;
    }
    .result-card-urls {
        font-size: 12px;
    }
    .result-card-url {
        color: var(--accent);
        text-decoration: none;
        display: block;
        padding: 2px 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .result-card-url:hover {
        text-decoration: underline;
    }
    .result-card-error {
        font-size: 13px;
        color: #cc6666;
    }
    .hidden {
        display: none !important;
    }
`;

// ── JavaScript ─────────────────────────────────────────────

const SCRIPT = `
(function () {
    var DATA = __INLINE_DATA__;
    var BASE = window.location.origin;
    var TOKEN = DATA.sessionToken;
    var TIMEOUT_SEC = DATA.timeout;
    var queries = DATA.queries || [];
    var results = {};
    var totalResults = 0;
    var summaryDone = false;
    var state = "searching";

    // DOM refs
    var timerEl = document.getElementById("timer");
    var heroTitle = document.querySelector(".hero-title");
    var heroDesc = document.querySelector(".hero-desc");
    var heroStatus = document.getElementById("hero-status");
    var resultCards = document.getElementById("result-cards");
    var sendBtn = document.getElementById("btn-send");
    var addInput = document.getElementById("add-search-input");
    var summaryPanel = document.getElementById("summary-panel");
    var summaryInput = document.getElementById("summary-input");
    var summaryGen = document.getElementById("summary-generating");
    var successOverlay = document.getElementById("success-overlay");
    var expiredOverlay = document.getElementById("expired-overlay");

    // Timer
    var endAt = Date.now() + TIMEOUT_SEC * 1000;
    var timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
    function updateTimer() {
        var left = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
        var min = Math.floor(left / 60);
        var sec = left % 60;
        timerEl.textContent = min + ":" + (sec < 10 ? "0" : "") + sec;
        if (left <= 10) {
            timerEl.className = "timer-badge urgent";
            if (left <= 0) { clearInterval(timerInterval); sendTimeout(); }
        } else if (left <= 30) {
            timerEl.className = "timer-badge warn";
        } else {
            timerEl.className = "timer-badge";
        }
    }

    // SSE connection
    var eventSource = new EventSource(BASE + "/events?session=" + TOKEN);
    eventSource.addEventListener("result", function (e) {
        var d = JSON.parse(e.data);
        addResultCard(d.queryIndex, d);
        totalResults++;
        updateSendButton();
    });
    eventSource.addEventListener("search-error", function (e) {
        var d = JSON.parse(e.data);
        addErrorCard(d.queryIndex, d);
        updateSendButton();
    });
    eventSource.addEventListener("done", function () {
        state = "selection";
        heroTitle.textContent = "Select results to send";
        heroStatus.textContent = "All searches complete";
        heroStatus.style.color = "var(--success)";
        updateSendButton();
    });
    eventSource.onerror = function () { };

    // Send on timeout
    function sendTimeout() {
        expiredOverlay.classList.remove("hidden");
        setTimeout(function () {
            sendSelection(true);
        }, 3000);
    }

    // Heartbeat
    setInterval(function () {
        fetch(BASE + "/heartbeat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: TOKEN })
        }).catch(function () { });
    }, 10000);

    // Add result card
    function addResultCard(index, data) {
        results[index] = data;
        var selectedClass = results._selected && results._selected[index] ? " selected" : "";
        var html = '<div class="result-card' + selectedClass + '" data-index="' + index + '" onclick="toggleCard(this)">';
        html += '<div class="result-card-header">';
        html += '<div class="result-card-check' + (results._selected && results._selected[index] ? " checked" : "") + '"></div>';
        html += '<div><div class="result-card-query">' + escapeHtml(data.query || "Search " + (index + 1)) + '</div>';
        html += '<div class="result-card-provider">via ' + escapeHtml(data.provider || "exa") + '</div>';
        html += '<div class="result-card-answer">' + escapeHtml(truncateText(data.answer || "(no answer)", 500)) + '</div>';
        if (data.results && data.results.length) {
            html += '<div class="result-card-urls">';
            for (var i = 0; i < Math.min(data.results.length, 5); i++) {
                var r = data.results[i];
                if (r) html += '<a class="result-card-url" href="' + escapeHtml(r.url) + '" target="_blank">' + escapeHtml(r.title || r.url) + '</a>';
            }
            if (data.results.length > 5) html += '<div class="result-card-url" style="color:var(--fg-dim)">... and ' + (data.results.length - 5) + ' more</div>';
            html += '</div>';
        }
        html += '</div></div></div>';
        resultCards.insertAdjacentHTML("beforeend", html);
    }

    function addErrorCard(index, data) {
        results[index] = { error: data.error || "Unknown error" };
        var html = '<div class="result-card" data-index="' + index + '">';
        html += '<div class="result-card-header">';
        html += '<div style="width:20px;height:20px;flex-shrink:0"></div>';
        html += '<div><div class="result-card-query">' + escapeHtml(data.query || "Search " + (index + 1)) + '</div>';
        html += '<div class="result-card-error">' + escapeHtml(data.error || "Unknown error") + '</div>';
        html += '</div></div></div>';
        resultCards.insertAdjacentHTML("beforeend", html);
    }

    // Card selection
    function toggleCard(el) {
        var index = parseInt(el.getAttribute("data-index"));
        if (!results._selected) results._selected = {};
        results._selected[index] = !results._selected[index];
        el.classList.toggle("selected");
        var check = el.querySelector(".result-card-check");
        if (check) {
            if (results._selected[index]) check.classList.add("checked");
            else check.classList.remove("checked");
        }
        updateSendButton();
    }

    // Send button
    function updateSendButton() {
        var selected = results._selected || {};
        var count = 0;
        for (var k in selected) { if (selected[k] && k !== "_selected") count++; }
        var all = Object.keys(results).filter(function (k) { return k !== "_selected"; }).length;
        if (state === "searching") {
            sendBtn.textContent = "Waiting for results\u2026";
            sendBtn.disabled = true;
        } else if (count > 0) {
            sendBtn.textContent = "Send " + count + " of " + all + " results";
            sendBtn.disabled = false;
        } else {
            sendBtn.textContent = "Send all " + all + " results";
            sendBtn.disabled = false;
        }
    }

    sendBtn.addEventListener("click", function () { sendSelection(false); });
    function sendSelection(isTimeout) {
        if (summaryDone) return;
        var selected = [];
        var sel = results._selected || {};
        var anySelected = false;
        for (var k in sel) { if (sel[k] && k !== "_selected") { selected.push(parseInt(k)); anySelected = true; } }
        if (!anySelected) {
            // Send all
            for (var k in results) { if (k !== "_selected") selected.push(parseInt(k)); }
        }
        showSummaryPanel(selected, isTimeout);
    }

    // Summary panel
    function showSummaryPanel(selected, isTimeout) {
        summaryPanel.classList.remove("hidden");
        summaryGen.classList.remove("hidden");
        summaryInput.value = "";
        document.getElementById("add-search").classList.add("hidden");
        sendBtn.disabled = true;
        sendBtn.textContent = "Generating summary\u2026";

        fetch(BASE + "/summarize", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: TOKEN, selected: selected })
        }).then(function (r) { return r.json(); }).then(function (d) {
            summaryGen.classList.add("hidden");
            if (d.ok && d.summary) {
                summaryInput.value = d.summary;
            } else {
                summaryInput.value = d.error || "Summary generation failed.";
            }
            summaryInput.disabled = false;
            sendBtn.textContent = "Approve & send";
            sendBtn.disabled = false;
        }).catch(function (err) {
            summaryGen.classList.add("hidden");
            summaryInput.value = "Error: " + err.message;
            sendBtn.textContent = "Send without summary";
            sendBtn.disabled = false;
        });
    }

    // Approve
    document.getElementById("btn-summary-approve").addEventListener("click", function () {
        approveSummary();
    });

    function approveSummary() {
        summaryDone = true;
        var selected = [];
        var sel = results._selected || {};
        var anySelected = false;
        for (var k in sel) { if (sel[k] && k !== "_selected") { selected.push(parseInt(k)); anySelected = true; } }
        if (!anySelected) {
            for (var k in results) { if (k !== "_selected") selected.push(parseInt(k)); }
        }

        fetch(BASE + "/submit", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: TOKEN, selected: selected, summary: summaryInput.value || undefined })
        }).then(function (r) { return r.json(); }).then(function (d) {
            successOverlay.classList.remove("hidden");
            setTimeout(function () { window.close(); }, 2000);
        }).catch(function () { });
    }

    // Back
    document.getElementById("btn-summary-back").addEventListener("click", function () {
        summaryPanel.classList.add("hidden");
        document.getElementById("add-search").classList.remove("hidden");
        updateSendButton();
    });

    // Regenerate
    document.getElementById("btn-summary-regenerate").addEventListener("click", function () {
        summaryGen.classList.remove("hidden");
        sendBtn.disabled = true;
        sendBtn.textContent = "Regenerating\u2026";
        var selected = [];
        var sel = results._selected || {};
        for (var k in sel) { if (sel[k] && k !== "_selected") selected.push(parseInt(k)); }
        fetch(BASE + "/summarize", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: TOKEN, selected: selected })
        }).then(function (r) { return r.json(); }).then(function (d) {
            summaryGen.classList.add("hidden");
            if (d.ok && d.summary) summaryInput.value = d.summary;
            sendBtn.textContent = "Approve & send";
            sendBtn.disabled = false;
        }).catch(function () { });
    });

    // Add search
    addInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && addInput.value.trim()) {
            var q = addInput.value.trim();
            addInput.value = "";
            fetch(BASE + "/search", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: TOKEN, query: q })
            }).then(function (r) { return r.json(); }).then(function (d) {
                if (d.ok && d.queryIndex !== undefined && !d.error) {
                    addResultCard(d.queryIndex, d);
                    totalResults++;
                }
            }).catch(function () { });
        }
    });

    // Utils
    function escapeHtml(s) {
        if (typeof s !== "string") return "";
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function truncateText(s, max) {
        if (!s) return "";
        return s.length > max ? s.slice(0, max) + "..." : s;
    }
})();
`;
