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
const runBtn = document.getElementById("run-btn");
const connectionStatus = document.getElementById("connection-status");
const progressSection = document.getElementById("progress-section");
const progressStage = document.getElementById("progress-stage");
const progressPercent = document.getElementById("progress-percent");
const progressFill = document.getElementById("progress-fill");
const progressMessage = document.getElementById("progress-message");
const cancelBtn = document.getElementById("cancel-btn");
const resultsSection = document.getElementById("results-section");
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

// State
let ws = null;
let currentJobId = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 3;
let servers = [];

// Load server configuration
async function loadServers() {
  try {
    const response = await fetch("/servers.json");
    if (response.ok) {
      const config = await response.json();
      servers = config.servers;
      populateServerDropdown();
    }
  } catch {
    console.warn("Could not load servers.json, using defaults");
    servers = [{ name: "Local Worker", url: "ws://localhost:8080" }];
    populateServerDropdown();
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
  progressSection.classList.remove("hidden");

  const stageLabels = {
    starting: "Initializing",
    running: "Running Audit",
    collecting: "Collecting Results",
    complete: "Complete",
    cancelled: "Cancelled",
  };

  progressStage.textContent = stageLabels[stage] || stage;
  progressPercent.textContent = `${percent || 0}%`;

  if (percent !== undefined) {
    progressFill.style.width = `${percent}%`;
  }

  if (message) {
    progressMessage.textContent = message;
  }

  if (stage === "running" || stage === "collecting") {
    cancelBtn.classList.remove("hidden");
  } else {
    cancelBtn.classList.add("hidden");
  }
}

function showResults(reportUrl, metrics, reportJson) {
  // Ensure progress is at 100% (defense in depth)
  updateProgress("complete", 100, "Test completed!");

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

  // Reset UI
  runBtn.disabled = false;
  runBtn.textContent = "Run Test";
  cancelBtn.classList.add("hidden");
}

function showError(message) {
  errorSection.classList.remove("hidden");
  errorText.textContent = message;
  runBtn.disabled = false;
  runBtn.textContent = "Run Test";
  cancelBtn.classList.add("hidden");
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

  let html = '<div class="audit-list">';

  for (const key of sortedKeys.slice(0, 50)) {
    const audit = audits[key];
    if (!audit || audit.score === null) continue;

    const score = audit.score;
    const status = score >= 0.9 ? "pass" : score >= 0.5 ? "average" : "fail";
    const statusIcon = status === "pass" ? "✓" : status === "average" ? "!" : "✗";
    const statusClass = status === "pass" ? "audit-pass" : status === "average" ? "audit-average" : "audit-fail";

    // Get description (strip HTML)
    const description = audit.description?.replace(/<[^>]*>/g, "") || audit.title || key;

    html += `
      <div class="audit-item ${statusClass}" data-audit="${key}">
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

  // Add click handlers
  document.querySelectorAll(".audit-item").forEach(item => {
    item.querySelector(".audit-header").addEventListener("click", () => {
      const content = item.querySelector(".audit-content");
      const arrow = item.querySelector(".audit-arrow");
      content.classList.toggle("hidden");
      arrow.classList.toggle("rotated");
    });
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
    { key: "first-contentful-paint", label: "First Contentful Paint", format: v => `${Math.round(v)}ms` },
    { key: "largest-contentful-paint", label: "Largest Contentful Paint", format: v => `${Math.round(v)}ms` },
    { key: "speed-index", label: "Speed Index", format: v => `${Math.round(v)}ms` },
    { key: "interactive", label: "Time to Interactive", format: v => `${Math.round(v)}ms` },
    { key: "total-blocking-time", label: "Total Blocking Time", format: v => `${Math.round(v)}ms` },
    { key: "cumulative-layout-shift", label: "Cumulative Layout Shift", format: v => v.toFixed(3) },
  ];

  let html = '<div class="summary-metrics">';
  html += '<h3>Core Web Vitals</h3>';
  html += '<div class="metrics-grid">';

  for (const { key, label, format } of keyMetrics) {
    const audit = metrics[key];
    if (!audit || audit.numericValue === undefined) continue;

    const value = format(audit.numericValue);
    const score = audit.score;
    const statusClass = score >= 0.9 ? "metric-good" : score >= 0.5 ? "metric-ok" : "metric-bad";

    html += `
      <div class="summary-metric ${statusClass}">
        <div class="summary-metric-label">${label}</div>
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
  } else {
    reportFrame.classList.add("hidden");
    viewToggleBtn.textContent = "View Original Report";
  }
});

function sendMessage(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function checkFormValidity() {
  const url = urlInput.value.trim();
  const hasConnection = ws?.readyState === WebSocket.OPEN;
  runBtn.disabled = !url || !hasConnection;
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

runBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  const profile = profileSelect.value;

  if (!url || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  // Reset UI
  errorSection.classList.add("hidden");
  resultsSection.classList.add("hidden");
  reportSection.classList.add("hidden");
  progressFill.style.width = "0%";

  // Disable button during test
  runBtn.disabled = true;
  runBtn.textContent = "Running...";

  // Send start message
  sendMessage({ type: "start", url, profile, jobId: currentJobId || undefined });
});

cancelBtn.addEventListener("click", () => {
  if (currentJobId) {
    sendMessage({ type: "cancel", jobId: currentJobId });
  }
});

// Heartbeat to detect dead connections
setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    sendMessage({ type: "ping" });
  }
}, 30000);

// Initialize
loadServers();

// Load custom servers from localStorage
const savedServers = localStorage.getItem("lighthouse-servers");
if (savedServers) {
  try {
    const parsed = JSON.parse(savedServers);
    servers = [...servers, ...parsed];
    populateServerDropdown();
  } catch {
    // Ignore invalid data
  }
}
