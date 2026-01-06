import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 8080;
const RESULTS_DIR = join(__dirname, "..", "results");
const FRONTEND_DIR = join(__dirname, "..", "frontend");

// Throttling profiles (for reference, actual throttling done by lighthouse CLI)
const PROFILES = ["none", "4g-fast", "4g-slow", "3g"];

// Track active jobs by connection ID
const activeJobs = new Map<string, { proc: any; ws: WebSocket }>();

// Send message to WebSocket
function send(ws: WebSocket, message: object) {
  ws.send(JSON.stringify(message));
}

// Start lighthouse test
function startTest(ws: WebSocket, url: string, profile: string, jobId: string) {
  if (!PROFILES.includes(profile)) {
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

  activeJobs.set(jobId, { proc, ws });

  // Capture stdout
  proc.stdout.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      // Parse lighthouse progress output
      if (line.includes("Analyzing") || line.includes("audit")) {
        send(ws, { type: "progress", stage: "running", message: line, percent: 50 });
      } else if (line.includes("report")) {
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
      // Construct web-accessible report URL (not filesystem path)
      // Lighthouse generates files with .report.html extension when using --output-path
      const reportWebPath = `/results/${hostname}_${profile}_${timestamp}/report.report.html`;

      // Read metrics if available
      let metrics: Record<string, unknown> = {};
      const metricsPath = join(RESULTS_DIR, `${hostname}_${profile}_${timestamp}`, "metrics.json");
      if (existsSync(metricsPath)) {
        try {
          const metricsData = readFileSync(metricsPath, "utf-8");
          metrics = JSON.parse(metricsData);
        } catch {
          // Metrics file not found or invalid
        }
      }

      // Read full report JSON for visual renderer
      let reportJson: Record<string, unknown> = {};
      const reportJsonPath = join(RESULTS_DIR, `${hostname}_${profile}_${timestamp}`, "report.report.json");
      if (existsSync(reportJsonPath)) {
        try {
          const jsonData = readFileSync(reportJsonPath, "utf-8");
          reportJson = JSON.parse(jsonData);
        } catch {
          // Report JSON not found or invalid
        }
      }

      // Send final progress update to show completion
      send(ws, { type: "progress", stage: "complete", percent: 100, message: "Test completed!" });

      send(ws, {
        type: "result",
        jobId,
        reportUrl: reportWebPath,
        metrics,
        reportJson, // Full Lighthouse JSON for visual rendering
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

// Get content type for static files
function getContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
  };
  return types[ext || ""] || "application/octet-stream";
}

// Serve static file with TypeScript transpilation
async function serveStaticFile(filePath: string): Promise<Response> {
  try {
    const ext = filePath.split(".").pop()?.toLowerCase();

    // Transpile TypeScript files
    if (ext === "ts") {
      const file = Bun.file(filePath);
      const source = await file.text();
      const { code } = await Bun.transpile(source, { loader: "ts" });
      return new Response(code, {
        headers: { "Content-Type": "application/javascript" },
      });
    }

    const file = Bun.file(filePath);
    return new Response(file, {
      headers: { "Content-Type": getContentType(filePath) },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// Create server with HTTP and WebSocket
const server = Bun.serve({
  port: PORT,

  fetch(req: Request): Response {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgrade = req.headers.get("upgrade") === "websocket";
      if (!upgrade) {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const success = server.upgrade(req, {
        data: { jobId: crypto.randomUUID() },
      });

      return success
        ? new Response(null, { status: 101 })
        : new Response("Upgrade failed", { status: 500 });
    }

    // Serve static files from results directory
    if (url.pathname.startsWith("/results/")) {
      const filePath = join(RESULTS_DIR, url.pathname.slice(9));
      return serveStaticFile(filePath);
    }

    // Serve frontend files
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(join(FRONTEND_DIR, "index.html")));
    }

    if (url.pathname === "/client.js") {
      return serveStaticFile(join(FRONTEND_DIR, "client.js"));
    }

    if (url.pathname === "/styles.css") {
      return new Response(Bun.file(join(FRONTEND_DIR, "styles.css")));
    }

    if (url.pathname === "/servers.json") {
      return new Response(Bun.file(join(FRONTEND_DIR, "servers.json")));
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    // Keep connection alive - prevent disconnects from idle timeout
    idleTimeout: 300, // 5 minutes max idle time
    pingInterval: 30000, // Send ping every 30 seconds

    open(ws: WebSocket) {
      const jobId = ws.data.jobId as string;
      ws.send(JSON.stringify({ type: "connected", jobId }));
    },

    message(ws: WebSocket, message: string) {
      const jobId = ws.data.jobId as string;

      try {
        const msg = JSON.parse(message);

        switch (msg.type) {
          case "start":
            startTest(ws, msg.url, msg.profile, msg.jobId || jobId);
            break;

          case "cancel":
            const job = activeJobs.get(msg.jobId);
            if (job) {
              job.proc.kill();
              activeJobs.delete(msg.jobId);
              ws.send(JSON.stringify({ type: "progress", stage: "cancelled", message: "Test cancelled" }));
            }
            break;

          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            break;
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      }
    },

    close(ws: WebSocket) {
      // Cleanup: kill any running jobs for this connection
      for (const [id, job] of activeJobs.entries()) {
        if (job.ws === ws) {
          job.proc.kill();
          activeJobs.delete(id);
        }
      }
    },
  },
});

console.log(`Lighthouse Worker Server running on http://localhost:${PORT}`);
console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
