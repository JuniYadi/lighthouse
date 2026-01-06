// Lighthouse Frontend Client
// Handles WebSocket communication and UI updates

// DOM Elements
const serverSelect = document.getElementById("server-select");
const customServerForm = document.getElementById("custom-server-form");
const customServerUrl = document.getElementById("custom-server-url");
const addServerBtn = document.getElementById("add-server-btn");
const saveServerBtn = document.getElementById("save-server-btn");
const cancelServerBtn = document.getElementById("cancel-server-btn");
const urlInput = document.getElementById("url-input");
const profileSelect = document.getElementById("profile-select");
const actionBtn = document.getElementById("action-btn"); // Renamed from run-btn
const connectionStatus = document.getElementById("connection-status");
const statusDisplay = document.getElementById("status-display"); // Renamed from progress-section
const progressStage = document.getElementById("progress-stage");
const progressMessage = document.getElementById("progress-message");
// const cancelBtn... removed, integrated into actionBtn
const resultsSection = document.getElementById("results-section");

// New Button Inner Elements
const btnStartState = actionBtn.querySelector(".start-state");
const btnRunningState = actionBtn.querySelector(".running-state");
const btnProgressRing = actionBtn.querySelector(".progress-ring-circle");
const btnProgressPercent = document.getElementById("btn-progress-percent");
const metricsSummary = document.getElementById("metrics-summary");
const reportSection = document.getElementById("report-section");
const reportFrame = document.getElementById("report-frame");
const reportSummary = document.getElementById("report-summary");
const auditDetails = document.getElementById("audit-details");
const openReportBtn = document.getElementById("open-report-btn");
const viewToggleBtn = document.getElementById("view-toggle-btn");
const errorSection = document.getElementById("error-section");
const errorText = document.getElementById("error-text");
const throttleInfoBtn = document.getElementById("throttle-info-btn");
const throttleInfoModal = document.getElementById("throttle-info-modal");
const closeThrottleInfoBtn = document.getElementById("close-throttle-info-btn");
const historyBtn = document.getElementById("history-btn");
const historyModal = document.getElementById("history-modal");
const closeHistoryBtn = document.getElementById("close-history-btn");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const historyList = document.getElementById("history-list");
const newTestBtn = document.getElementById("new-test-btn");
const heroSection = document.querySelector(".hero-section");

// State
let ws = null;
let currentJobId = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 3;
let servers = [];
let history = [];

// Load server configuration
async function loadServers() {
  let loadedServers = [];
  try {
    const response = await fetch("/servers.json");
    if (response.ok) {
      const config = await response.json();
      loadedServers = config.servers;
    }
  } catch {
    console.warn("Could not load servers.json, using defaults");
    loadedServers = [{ name: "Local Worker", url: "ws://localhost:8080" }];
  }

  // Load custom servers from localStorage
  const savedServers = localStorage.getItem("lighthouse-servers");
  if (savedServers) {
    try {
      const parsed = JSON.parse(savedServers);
      parsed.forEach(s => {
        if (!loadedServers.find(existing => existing.url === s.url)) {
          loadedServers.push(s);
        }
      });
    } catch {
      // Ignore invalid data
    }
  }

  servers = loadedServers;
  populateServerDropdown();
  
  // Initial connection
  if (serverSelect.value) {
    connectToServer(serverSelect.value);
  }
}

function populateServerDropdown() {
  serverSelect.innerHTML = servers
    .map((s) => `<option value="${s.url}">${s.name}</option>`)
    .join("");
}

// Connect to WebSocket server
function connectToServer(url) {
  if (ws) {
    ws.close();
  }

  // Append /ws path for Bun WebSocket server
  const wsUrl = url.replace(/\/$/, "") + "/ws";
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateConnectionStatus(true);
    reconnectAttempts = 0;
    checkFormValidity();
  };

  ws.onclose = () => {
    updateConnectionStatus(false);
    ws = null;

    // Attempt to reconnect if we have a current job
    if (currentJobId && reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      setTimeout(() => connectToServer(url), 2000 * reconnectAttempts);
    }
  };

  ws.onerror = () => {
    updateConnectionStatus(false);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch {
      console.error("Failed to parse server message");
    }
  };
}

function updateConnectionStatus(connected) {
  connectionStatus.className = connected ? "status connected" : "status disconnected";
  const text = connectionStatus.querySelector(".status-text");
  text.textContent = connected ? "Connected" : "Disconnected";
  checkFormValidity();
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case "connected":
      currentJobId = msg.jobId;
      break;

    case "progress":
      updateProgress(msg.stage, msg.percent, msg.message);
      break;

    case "result":
      showResults(msg.reportUrl, msg.metrics, msg.reportJson);
      break;

    case "error":
      showError(msg.message);
      break;

    case "pong":
      // Heartbeat response
      break;
  }
}

function updateProgress(stage, percent, message) {
  statusDisplay.classList.remove("hidden");

  // Ensure button is in running state visually
  if (stage !== "complete" && stage !== "cancelled") {
      setButtonState("running");
  }

  const stageLabels = {
    starting: "Initializing",
    running: "Running Audit",
    collecting: "Collecting Results",
    complete: "Complete",
    cancelled: "Cancelled",
  };

  progressStage.textContent = stageLabels[stage] || stage;
  
  const p = percent || 0;
  if (btnProgressPercent) btnProgressPercent.textContent = `${p}%`;

  // Update Ring
  const circumference = 283;
  const offset = circumference - (p / 100) * circumference;
  if (btnProgressRing) btnProgressRing.style.strokeDashoffset = offset;

  // Strip ANSI color codes from log messages
  if (message) {
    const cleanMessage = message.replace(/\x1B\[\d+;?\d*m/g, "").replace(/\x1B\[0m/g, "");
    progressMessage.textContent = cleanMessage;
  }
}

function setButtonState(state) {
  if (state === "running") {
    actionBtn.classList.add("running");
    btnStartState.classList.add("hidden");
    btnRunningState.classList.remove("hidden");
    actionBtn.disabled = false; // Ensure clickable for cancel
    
    // Disable inputs
    urlInput.disabled = true;
    profileSelect.disabled = true;
  } else {
    actionBtn.classList.remove("running");
    btnStartState.classList.remove("hidden");
    btnRunningState.classList.add("hidden");
    if (btnProgressRing) btnProgressRing.style.strokeDashoffset = 283; // Reset ring
    
    // Re-enable inputs
    urlInput.disabled = false;
    profileSelect.disabled = false;
    checkFormValidity(); // Re-check if button should be enabled based on inputs
  }
}

function showResults(reportUrl, metrics, reportJson, saveToHistory = true) {
  // Ensure progress is at 100% (defense in depth)
  updateProgress("complete", 100, "Test completed!");
  
  // Hide detailed progress status, but we might want to keep "Complete" message for a moment?
  // For now let's hide the container after a short delay or just let the report take over.
  // statusDisplay.classList.add("hidden");

  // Save to History
  if (saveToHistory) {
    saveHistoryItem({
      timestamp: new Date().toISOString(),
      url: urlInput.value,
      profile: profileSelect.value,
      reportUrl,
      metrics,
      reportJson
    });
  }
  
  // Hide input form on completion (UX improvement)
  if (heroSection) heroSection.classList.add("hidden");

  // Show metrics summary - ONLY category scores in the top Results section
  resultsSection.classList.remove("hidden");

  const categoryLabels = {
    performance: "Performance",
    accessibility: "Accessibility",
    "best-practices": "Best Practices",
    seo: "SEO",
  };

  let metricsHtml = "";

  // Show ONLY category scores (Performance, Accessibility, Best Practices, SEO)
  if (metrics.categories) {
    for (const [key, value] of Object.entries(metrics.categories)) {
      const label = categoryLabels[key] || key;
      const score = value;
      const scoreClass = score >= 90 ? "score-good" : score >= 50 ? "score-average" : "score-poor";

      metricsHtml += `
        <div class="metric-card ${scoreClass}">
          <div class="metric-label">${label}</div>
          <div class="metric-value">${score}</div>
        </div>
      `;
    }
  }

  metricsSummary.innerHTML = metricsHtml || "<p>No metrics available</p>";

  // Show report section with visual renderer
  reportSection.classList.remove("hidden");
  reportFrame.src = reportUrl;

  // Render visual report from JSON data
  if (reportJson && Object.keys(reportJson).length > 0) {
    renderReport(reportUrl, reportJson);
  } else {
    // Fallback when no JSON data available
    auditDetails.innerHTML = "<p class='no-data'>Click 'Open Full Report' to view the complete report.</p>";
    reportSummary.innerHTML = "";
  }

  // Reset UI Button
  setButtonState("idle");
}

function showError(message) {
  errorSection.classList.remove("hidden");
  errorText.textContent = message;
  setButtonState("idle");
}

// =============================================================================
// Visual Report Renderer
// =============================================================================

function renderReport(reportUrl, fullJson) {
  // Set open report button
  openReportBtn.href = reportUrl;

  // Show/hide iframe based on toggle
  const showIframe = viewToggleBtn.textContent === "View Original Report";
  if (showIframe) {
    reportFrame.classList.remove("hidden");
  } else {
    reportFrame.classList.add("hidden");
  }

  // If no JSON data, just show the iframe link
  if (!fullJson || !fullJson.audits) {
    auditDetails.innerHTML = "<p class='no-data'>No audit details available. Click 'Open Full Report' to view the complete report.</p>";
    reportSummary.innerHTML = "";
    return;
  }

  // Render audit details
  renderAuditDetails(fullJson.audits);

  // Render summary (Core Web Vitals)
  renderSummary(fullJson);
}

function renderAuditDetails(audits) {
  const auditOrder = [
    "first-contentful-paint",
    "largest-contentful-paint",
    "first-meaningful-paint",
    "speed-index",
    "interactive",
    "total-blocking-time",
    "max-potential-fid",
    "cumulative-layout-shift",
    "errors-in-console",
    "image-alt",
    "button-name",
    "color-contrast",
    "html-has-lang",
    "charset",
    " Doctype",
    "link-text",
    "canonical",
    "meta-viewport",
    "plugins",
    "redirect",
    "tap-targets",
    "viewport",
    "is-on-https",
    "document-title",
    "html-has-lang",
  ];

  const priorityAudits = auditOrder.filter(a => audits[a]);
  const otherAudits = Object.keys(audits).filter(a => !auditOrder.includes(a) && !audits[a].manual);

  // Combine: priority first, then pass/fail, then others
  const sortedKeys = [
    ...priorityAudits,
    ...Object.keys(audits).filter(k =>
      !priorityAudits.includes(k) &&
      audits[k].score !== null &&
      audits[k].score < 1 &&
      !audits[k].manual
    ),
    ...otherAudits.filter(k => audits[k].score !== null),
  ];

  // 1. Add Filter Controls
  let html = `
    <div class="audit-controls">
      <div class="filter-bar">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="fail">Opportunities & Errors</button>
        <button class="filter-btn" data-filter="average">Diagnostics</button>
        <button class="filter-btn" data-filter="pass">Passed</button>
      </div>
      <button class="filter-btn" id="collapse-all-btn">Collapse All</button>
    </div>
  `;
  
  html += '<div class="audit-list">';

  for (const key of sortedKeys.slice(0, 50)) {
    const audit = audits[key];
    if (!audit || audit.score === null) continue;

    const score = audit.score;
    const status = score >= 0.9 ? "pass" : score >= 0.5 ? "average" : "fail";
    const statusIcon = status === "pass" ? "✓" : status === "average" ? "!" : "✗";
    const statusClass = status === "pass" ? "audit-pass" : status === "average" ? "audit-average" : "audit-fail";

    // Get description (strip HTML)
    const description = audit.description?.replace(/<[^>]*>/g, "") || audit.title || key;

    // Add data-status for filtering
    html += `
      <div class="audit-item ${statusClass}" data-audit="${key}" data-status="${status}">
        <div class="audit-header">
          <span class="audit-status">${statusIcon}</span>
          <span class="audit-title">${audit.title || key}</span>
          <span class="audit-arrow">▶</span>
        </div>
        <div class="audit-content hidden">
          <p class="audit-description">${description}</p>
          ${audit.displayValue ? `<p class="audit-display-value">${audit.displayValue}</p>` : ""}
          ${audit.details?.items?.length ? renderAuditDetailsTable(audit.details) : ""}
        </div>
      </div>
    `;
  }

  html += '</div>';
  auditDetails.innerHTML = html;

  // Add click handlers for Accordion
  document.querySelectorAll(".audit-item").forEach(item => {
    item.querySelector(".audit-header").addEventListener("click", () => {
      const content = item.querySelector(".audit-content");
      const arrow = item.querySelector(".audit-arrow");
      content.classList.toggle("hidden");
      arrow.classList.toggle("rotated");
    });
  });

  // Add Filter Logic
  document.querySelectorAll(".filter-btn[data-filter]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      // Update active state
      document.querySelectorAll(".filter-btn[data-filter]").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");

      const filter = e.target.dataset.filter;
      const items = document.querySelectorAll(".audit-item");

      items.forEach(item => {
        if (filter === "all" || item.dataset.status === filter) {
          item.classList.remove("hidden");
        } else {
          item.classList.add("hidden");
        }
      });
    });
  });

  // Add Collapse All Logic
  document.getElementById("collapse-all-btn").addEventListener("click", () => {
    document.querySelectorAll(".audit-content").forEach(c => c.classList.add("hidden"));
    document.querySelectorAll(".audit-arrow").forEach(a => a.classList.remove("rotated"));
  });
}

function renderAuditDetailsTable(details) {
  if (!details?.items?.length) return "";

  const items = details.items.slice(0, 5);
  const keys = Object.keys(items[0] || {});

  let html = '<table class="audit-table"><thead><tr>';
  for (const key of keys.slice(0, 3)) {
    html += `<th>${key}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const item of items) {
    html += '<tr>';
    for (const key of keys.slice(0, 3)) {
      let value = item[key];
      if (typeof value === "object") value = JSON.stringify(value);
      html += `<td>${value || "-"}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

function renderSummary(json) {
  const metrics = json.audits;

  const keyMetrics = [
    { 
      key: "first-contentful-paint", 
      label: "First Contentful Paint", 
      format: v => `${Math.round(v)}ms`, 
      desc: "First Contentful Paint marks the time at which the first text or image is painted. " 
    },
    { 
      key: "largest-contentful-paint", 
      label: "Largest Contentful Paint", 
      format: v => `${Math.round(v)}ms`,
      desc: "Largest Contentful Paint marks the time at which the largest text or image is painted. "
    },
    { 
      key: "speed-index", 
      label: "Speed Index", 
      format: v => `${Math.round(v)}ms`,
      desc: "Speed Index shows how quickly the contents of a page are visibly populated."
    },
    { 
      key: "interactive", 
      label: "Time to Interactive", 
      format: v => `${Math.round(v)}ms`,
      desc: "Time to interactive is the amount of time it takes for the page to become fully interactive."
    },
    { 
      key: "total-blocking-time", 
      label: "Total Blocking Time", 
      format: v => `${Math.round(v)}ms`,
      desc: "Sum of all time periods between FCP and Time to Interactive, when task length exceeded 50ms, expressed in milliseconds."
    },
    { 
      key: "cumulative-layout-shift", 
      label: "Cumulative Layout Shift", 
      format: v => v.toFixed(3),
      desc: "Cumulative Layout Shift measures the movement of visible elements within the viewport."
    },
  ];

  let html = '<div class="summary-metrics">';
  html += '<h3>Core Web Vitals</h3>';
  html += '<div class="vitals-grid">';

  for (const { key, label, format, desc } of keyMetrics) {
    const audit = metrics[key];
    if (!audit || audit.numericValue === undefined) continue;

    const value = format(audit.numericValue);
    const score = audit.score;
    const statusClass = score >= 0.9 ? "metric-good" : score >= 0.5 ? "metric-ok" : "metric-bad";

    html += `
      <div class="summary-metric ${statusClass}">
        <div class="summary-metric-label">
          ${label}
          <span class="tooltip-icon" data-tooltip="${desc}">?</span>
        </div>
        <div class="summary-metric-value">${value}</div>
      </div>
    `;
  }

  html += '</div></div>';
  reportSummary.innerHTML = html;
}

// Toggle between visual view and original iframe
viewToggleBtn.addEventListener("click", () => {
  if (reportFrame.classList.contains("hidden")) {
    reportFrame.classList.remove("hidden");
    viewToggleBtn.textContent = "View Details";
    
    // Hide other sections for cleaner view
    heroSection.classList.add("hidden");
    resultsSection.classList.add("hidden");
    auditDetails.classList.add("hidden");
    reportSummary.classList.add("hidden");
  } else {
    reportFrame.classList.add("hidden");
    viewToggleBtn.textContent = "View Original Report";
    
    // Show sections back
    heroSection.classList.remove("hidden");
    resultsSection.classList.remove("hidden");
    auditDetails.classList.remove("hidden");
    reportSummary.classList.remove("hidden");
  }
});

function sendMessage(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function checkFormValidity() {
  // Only update validity if we are NOT currently running a test
  if (actionBtn.classList.contains("running")) return;

  const url = urlInput.value.trim();
  const hasConnection = ws?.readyState === WebSocket.OPEN;
  actionBtn.disabled = !url || !hasConnection;
}

// Event Listeners
serverSelect.addEventListener("change", () => {
  const url = serverSelect.value;
  if (url) {
    connectToServer(url);
  }
});

addServerBtn.addEventListener("click", () => {
  customServerForm.classList.remove("hidden");
  customServerUrl.focus();
});

saveServerBtn.addEventListener("click", () => {
  const url = customServerUrl.value.trim();
  if (url) {
    // Validate WebSocket URL
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      alert("Please enter a valid WebSocket URL (ws:// or wss://)");
      return;
    }

    const name = `Custom (${url})`;
    servers.push({ name, url });
    serverSelect.innerHTML += `<option value="${url}">${name}</option>`;
    serverSelect.value = url;

    // Save to localStorage for persistence
    localStorage.setItem("lighthouse-servers", JSON.stringify(servers));

    customServerForm.classList.add("hidden");
    customServerUrl.value = "";
    connectToServer(url);
  }
});

cancelServerBtn.addEventListener("click", () => {
  customServerForm.classList.add("hidden");
  customServerUrl.value = "";
});

// Throttle Info Modal Listeners
if (throttleInfoBtn) {
  throttleInfoBtn.addEventListener("click", () => {
    throttleInfoModal.classList.remove("hidden");
  });
}

if (closeThrottleInfoBtn) {
  closeThrottleInfoBtn.addEventListener("click", () => {
    throttleInfoModal.classList.add("hidden");
  });
}

if (throttleInfoModal) {
  throttleInfoModal.addEventListener("click", (e) => {
    if (e.target === throttleInfoModal) {
      throttleInfoModal.classList.add("hidden");
    }
  });
}

urlInput.addEventListener("input", checkFormValidity);

actionBtn.addEventListener("click", () => {
  // If running -> Cancel Action
  if (actionBtn.classList.contains("running")) {
    if (currentJobId) {
      sendMessage({ type: "cancel", jobId: currentJobId });
      updateProgress("cancelled", null, "Cancelling...");
    }
    return;
  }

  // If idle -> Start Action
  const url = urlInput.value.trim();
  const profile = profileSelect.value;

  if (!url || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  // Reset UI
  errorSection.classList.add("hidden");
  resultsSection.classList.add("hidden");
  reportSection.classList.add("hidden");
  statusDisplay.classList.add("hidden");

  // Initiate running state
  setButtonState("running");
  
  // Send start message
  sendMessage({ type: "start", url, profile, jobId: currentJobId || undefined });
});

// Heartbeat to detect dead connections
setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    sendMessage({ type: "ping" });
  }
}, 30000);

// Initialize
loadServers();

// =============================================================================
// History Management
// =============================================================================

function loadHistory() {
  const saved = localStorage.getItem("lighthouse-history");
  if (saved) {
    try {
      history = JSON.parse(saved);
    } catch {
      history = [];
    }
  }
}

function saveHistoryItem(item) {
  history.unshift(item); // Add to beginning
  if (history.length > 20) {
    history.pop(); // Keep max 20 items
  }
  localStorage.setItem("lighthouse-history", JSON.stringify(history));
}

function renderHistoryList() {
  if (history.length === 0) {
    historyList.innerHTML = '<p class="text-muted">No history available.</p>';
    return;
  }

  historyList.innerHTML = history.map((item, index) => {
    // Calculate Score average or main score
    const score = item.metrics?.categories?.performance 
      ? Math.round(item.metrics.categories.performance) 
      : 0;
    const scoreClass = score >= 90 ? "score-good" : score >= 50 ? "score-average" : "score-poor";
    const date = new Date(item.timestamp).toLocaleString();

    return `
      <div class="history-item" style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid var(--border-color); transition: background 0.2s;">
        <div style="display: flex; align-items: center; flex: 1; cursor: pointer;" onclick="restoreHistoryItem(${index})">
          <div class="score-badge ${scoreClass}" style="width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 15px; background: #333; color: white; border: 2px solid currentColor;">
            ${score}
          </div>
          <div>
            <div style="font-weight: 600; margin-bottom: 2px; color: var(--text-main);">${item.url}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${date} - ${item.profile}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <a href="${item.reportUrl}" target="_blank" title="Open Report" style="color: var(--text-muted); display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
            </a>
            <button onclick="restoreHistoryItem(${index})" style="background: none; border: none; color: var(--primary); cursor: pointer; font-weight: 500;">
                Load &rarr;
            </button>
        </div>
      </div>
    `;
  }).join("");
}

// Make global to be accessible via onclick
window.restoreHistoryItem = function(index) {
  const item = history[index];
  if (!item) return;

  historyModal.classList.add("hidden");
  
  // Restore State
  urlInput.value = item.url;
  profileSelect.value = item.profile;
  
  // Show Results (Re-use existing function)
  showResults(item.reportUrl, item.metrics, item.reportJson, false);
};

// History Listeners
if (historyBtn) {
  historyBtn.addEventListener("click", () => {
    renderHistoryList();
    historyModal.classList.remove("hidden");
  });
}

if (closeHistoryBtn) {
  closeHistoryBtn.addEventListener("click", () => {
    historyModal.classList.add("hidden");
  });
}

if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear all history?")) {
      history = [];
      localStorage.removeItem("lighthouse-history");
      renderHistoryList();
    }
  });
}

if (historyModal) {
  historyModal.addEventListener("click", (e) => {
    if (e.target === historyModal) {
      historyModal.classList.add("hidden");
    }
  });
}

// New Test Button
if (newTestBtn) {
  newTestBtn.addEventListener("click", () => {
    // Hide Results
    resultsSection.classList.add("hidden");
    reportSection.classList.add("hidden");
    errorSection.classList.add("hidden");
    statusDisplay.classList.add("hidden");
    
    // Show Hero Section
    heroSection.classList.remove("hidden");
    
    // Reset Progress
    setButtonState("idle");
    if (progressStage) progressStage.textContent = "Ready";
  });
}

// Load History on Start
loadHistory();
