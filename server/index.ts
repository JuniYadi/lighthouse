import { WebSocketServer, WebSocket } from "ws";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { extname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 8080;
const RESULTS_DIR = join(__dirname, "..", "results");

// Throttling profiles
const PROFILES: Record<string, { rtt: number; throughput: number; cpu: number }> = {
  "none": { rtt: 0, throughput: 10000, cpu: 1 },
  "4g-fast": { rtt: 40, throughput: 10000, cpu: 1 },
  "4g-slow": { rtt: 100, throughput: 1500, cpu: 4 },
  "3g": { rtt: 300, throughput: 400, cpu: 4 },
};

// Track active jobs
const activeJobs = new Map<string, { process: any; ws: WebSocket }>();

// Send message to WebSocket
function send(ws: WebSocket, message: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Start lighthouse test
function startTest(ws: WebSocket, url: string, profile: string, jobId: string) {
  const profileConfig = PROFILES[profile];
  if (!profileConfig) {
    send(ws, { type: "error", message: `Unknown profile: ${profile}` });
    return;
  }

  // Generate output directory based on URL and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const hostname = new URL(url).hostname.replace(/\./g, "_");
  const outputDir = join(RESULTS_DIR, `${hostname}_${profile}_${timestamp}`);

  // Build lighthouse command
  const args = [
    "../lighthouse-throttle.sh",
    url,
    "--throttling",
    profile,
    "--output-dir",
    outputDir,
  ];

  send(ws, { type: "progress", stage: "starting", message: "Initializing lighthouse..." });

  // Spawn subprocess
  const proc = spawn("bash", args, {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
  });

  activeJobs.set(jobId, { process: proc, ws });

  let reportUrl = "";

  // Capture stdout
  proc.stdout.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      // Parse lighthouse progress output
      if (line.includes("Analyzing") || line.includes("audit")) {
        send(ws, { type: "progress", stage: "running", message: line, percent: 50 });
      } else if (line.includes("report")) {
        reportUrl = line.split(" ")[1] || "";
        send(ws, { type: "progress", stage: "collecting", percent: 80, message: "Collecting results..." });
      } else {
        send(ws, { type: "progress", stage: "running", message: line, percent: 60 });
      }
    }
  });

  // Capture stderr
  proc.stderr.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line && !line.includes("Chrome") && !line.includes("warning")) {
      send(ws, { type: "progress", stage: "running", message: line, percent: 70 });
    }
  });

  // Process completion
  proc.on("close", (code: number) => {
    activeJobs.delete(jobId);

    if (code === 0) {
      // Construct report URL for iframe
      const reportPath = `${hostname}_${profile}_${timestamp}/report.html`;
      const fullReportUrl = `/results/${reportPath}`;

      // Read metrics if available
      let metrics: any = {};
      try {
        const metricsPath = join(RESULTS_DIR, `${hostname}_${profile}_${timestamp}`, "metrics.json");
        const metricsData = readFileSync(metricsPath, "utf-8");
        metrics = JSON.parse(metricsData);
      } catch (e) {
        // Metrics file not found, use empty object
      }

      send(ws, {
        type: "result",
        jobId,
        reportUrl: fullReportUrl,
        metrics,
      });
    } else {
      send(ws, { type: "error", message: `Test failed with exit code ${code}` });
    }
  });

  proc.on("error", (err: Error) => {
    activeJobs.delete(jobId);
    send(ws, { type: "error", message: `Process error: ${err.message}` });
  });
}

// Create HTTP server with static file serving
const server = Bun.serve({
  port: PORT,
  fetch(req: Request) {
    const url = new URL(req.url);

    // Serve static files from results directory
    if (url.pathname.startsWith("/results/")) {
      const filePath = join(RESULTS_DIR, url.pathname.slice(9));
      return serveStaticFile(filePath);
    }

    // Serve frontend files
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(join(__dirname, "..", "frontend", "index.html")));
    }

    if (url.pathname === "/client.js") {
      return new Response(Bun.file(join(__dirname, "..", "frontend", "client.ts")));
    }

    if (url.pathname === "/styles.css") {
      return new Response(Bun.file(join(__dirname, "..", "frontend", "styles.css")));
    }

    if (url.pathname === "/servers.json") {
      return new Response(Bun.file(join(__dirname, "..", "frontend", "servers.json")));
    }

    return new Response("Not Found", { status: 404 });
  },
});

// Serve static file helper
async function serveStaticFile(filePath: string): Promise<Response> {
  try {
    const ext = extname(filePath);
    const contentType: Record<string, string> = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
    };

    // Transpile TypeScript files to JavaScript
    if (ext === ".ts") {
      const file = Bun.file(filePath);
      const source = await file.text();
      const { code } = await Bun.transpile(source, { loader: "ts" });
      return new Response(code, {
        headers: { "Content-Type": "application/javascript" },
      });
    }

    const file = Bun.file(filePath);
    return new Response(file, {
      headers: { "Content-Type": contentType[ext] || "application/octet-stream" },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  const jobId = crypto.randomUUID();

  send(ws, { type: "connected", jobId });

  ws.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case "start":
          startTest(ws, msg.url, msg.profile, msg.jobId || jobId);
          break;

        case "cancel":
          const job = activeJobs.get(msg.jobId);
          if (job) {
            job.process.kill();
            activeJobs.delete(msg.jobId);
            send(ws, { type: "progress", stage: "cancelled", message: "Test cancelled" });
          }
          break;

        case "ping":
          send(ws, { type: "pong" });
          break;
      }
    } catch (e) {
      send(ws, { type: "error", message: "Invalid message format" });
    }
  });

  ws.on("close", () => {
    // Cleanup: kill any running jobs for this connection
    for (const [id, job] of activeJobs.entries()) {
      if (job.ws === ws) {
        job.process.kill();
        activeJobs.delete(id);
      }
    }
  });
});

console.log(`Lighthouse Worker Server running on http://localhost:${PORT}`);
console.log(`WebSocket server running on ws://localhost:${PORT}`);
