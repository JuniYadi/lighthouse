// Lighthouse Frontend Client
// Handles WebSocket communication and UI updates

interface ServerConfig {
  name: string;
  url: string;
}

interface ServersConfig {
  servers: ServerConfig[];
}

interface Metrics {
  timestamp: string;
  url: string;
  throttling: string;
  categories?: {
    performance?: number;
    accessibility?: number;
    "best-practices"?: number;
    seo?: number;
  };
  metrics?: {
    fcp?: number;
    lcp?: number;
    tti?: number;
    speed_index?: number;
    cls?: number;
    total_blocking_time?: number;
  };
}

type ServerMessage =
  | { type: "connected"; jobId: string }
  | { type: "progress"; stage: string; percent?: number; message?: string }
  | { type: "result"; jobId: string; reportUrl: string; metrics: Metrics }
  | { type: "error"; message: string }
  | { type: "pong" };

type ClientMessage =
  | { type: "start"; url: string; profile: string; jobId?: string }
  | { type: "cancel"; jobId: string }
  | { type: "ping" };

// DOM Elements
const serverSelect = document.getElementById("server-select") as HTMLSelectElement;
const customServerForm = document.getElementById("custom-server-form") as HTMLDivElement;
const customServerUrl = document.getElementById("custom-server-url") as HTMLInputElement;
const addServerBtn = document.getElementById("add-server-btn") as HTMLButtonElement;
const saveServerBtn = document.getElementById("save-server-btn") as HTMLButtonElement;
const cancelServerBtn = document.getElementById("cancel-server-btn") as HTMLButtonElement;
const urlInput = document.getElementById("url-input") as HTMLInputElement;
const profileSelect = document.getElementById("profile-select") as HTMLSelectElement;
const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
const connectionStatus = document.getElementById("connection-status") as HTMLDivElement;
const progressSection = document.getElementById("progress-section") as HTMLDivElement;
const progressStage = document.getElementById("progress-stage") as HTMLSpanElement;
const progressPercent = document.getElementById("progress-percent") as HTMLSpanElement;
const progressFill = document.getElementById("progress-fill") as HTMLDivElement;
const progressMessage = document.getElementById("progress-message") as HTMLParagraphElement;
const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;
const resultsSection = document.getElementById("results-section") as HTMLDivElement;
const metricsSummary = document.getElementById("metrics-summary") as HTMLDivElement;
const reportSection = document.getElementById("report-section") as HTMLDivElement;
const reportFrame = document.getElementById("report-frame") as HTMLIFrameElement;
const errorSection = document.getElementById("error-section") as HTMLDivElement;
const errorText = document.getElementById("error-text") as HTMLSpanElement;

// State
let ws: WebSocket | null = null;
let currentJobId: string | null = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 3;
let servers: ServerConfig[] = [];

// Load server configuration
async function loadServers(): Promise<void> {
  try {
    const response = await fetch("/servers.json");
    if (response.ok) {
      const config: ServersConfig = await response.json();
      servers = config.servers;
      populateServerDropdown();
    }
  } catch {
    console.warn("Could not load servers.json, using defaults");
    servers = [{ name: "Local Worker", url: "ws://localhost:8080" }];
    populateServerDropdown();
  }
}

function populateServerDropdown(): void {
  serverSelect.innerHTML = servers
    .map((s) => `<option value="${s.url}">${s.name} (${s.url})</option>`)
    .join("");
}

// Connect to WebSocket server
function connectToServer(url: string): void {
  if (ws) {
    ws.close();
  }

  ws = new WebSocket(url);

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
      const msg: ServerMessage = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch {
      console.error("Failed to parse server message");
    }
  };
}

function updateConnectionStatus(connected: boolean): void {
  connectionStatus.className = connected ? "status connected" : "status disconnected";
  const text = connectionStatus.querySelector(".status-text") as HTMLSpanElement;
  text.textContent = connected ? "Connected" : "Disconnected";
  checkFormValidity();
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "connected":
      currentJobId = msg.jobId;
      break;

    case "progress":
      updateProgress(msg.stage, msg.percent, msg.message);
      break;

    case "result":
      showResults(msg.reportUrl, msg.metrics);
      break;

    case "error":
      showError(msg.message);
      break;

    case "pong":
      // Heartbeat response
      break;
  }
}

function updateProgress(stage: string, percent?: number, message?: string): void {
  progressSection.classList.remove("hidden");

  const stageLabels: Record<string, string> = {
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

function showResults(reportUrl: string, metrics: Metrics): void {
  // Show metrics summary
  resultsSection.classList.remove("hidden");

  const categoryLabels: Record<string, string> = {
    performance: "Performance",
    accessibility: "Accessibility",
    "best-practices": "Best Practices",
    seo: "SEO",
  };

  const metricLabels: Record<string, { label: string; unit: string }> = {
    fcp: { label: "First Contentful Paint", unit: "ms" },
    lcp: { label: "Largest Contentful Paint", unit: "ms" },
    tti: { label: "Time to Interactive", unit: "ms" },
    speed_index: { label: "Speed Index", unit: "ms" },
    cls: { label: "Cumulative Layout Shift", unit: "" },
    total_blocking_time: { label: "Total Blocking Time", unit: "ms" },
  };

  let metricsHtml = "";

  // Category scores
  if (metrics.categories) {
    for (const [key, value] of Object.entries(metrics.categories)) {
      const label = categoryLabels[key] || key;
      metricsHtml += `
        <div class="metric-card">
          <div class="metric-label">${label}</div>
          <div class="metric-value">${value}</div>
        </div>
      `;
    }
  }

  // Core metrics
  if (metrics.metrics) {
    for (const [key, value] of Object.entries(metrics.metrics)) {
      const config = metricLabels[key];
      if (config && value !== undefined) {
        const displayValue = key === "cls" ? value.toFixed(3) : Math.round(value);
        metricsHtml += `
          <div class="metric-card">
            <div class="metric-label">${config.label}</div>
            <div class="metric-value">${displayValue}<span class="metric-unit"> ${config.unit}</span></div>
          </div>
        `;
      }
    }
  }

  metricsSummary.innerHTML = metricsHtml || "<p>No metrics available</p>";

  // Show report iframe
  reportSection.classList.remove("hidden");
  reportFrame.src = reportUrl;

  // Reset UI
  runBtn.disabled = false;
  runBtn.textContent = "Run Test";
  cancelBtn.classList.add("hidden");
}

function showError(message: string): void {
  errorSection.classList.remove("hidden");
  errorText.textContent = message;
  runBtn.disabled = false;
  runBtn.textContent = "Run Test";
  cancelBtn.classList.add("hidden");
}

function sendMessage(msg: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function checkFormValidity(): void {
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
    const parsed: ServerConfig[] = JSON.parse(savedServers);
    servers = [...servers, ...parsed];
    populateServerDropdown();
  } catch {
    // Ignore invalid data
  }
}
