const http = require("http");
const client = require("prom-client");

const register = new client.Registry();
client.collectDefaultMetrics({ register });
const queueDepth = new client.Gauge({ name: "queue_depth", help: "Current BullMQ waiting job count", labelNames: ["queue"], registers: [register] });
const jobDurationSeconds = new client.Histogram({ name: "job_duration_seconds", help: "BullMQ job processing duration in seconds", labelNames: ["stage"], registers: [register], buckets: [1, 5, 15, 30, 60, 180, 600, 1800] });
const jobFailuresTotal = new client.Counter({ name: "job_failures_total", help: "BullMQ job failures by processing stage", labelNames: ["stage"], registers: [register] });
const whisperRealTimeFactor = new client.Gauge({ name: "whisper_real_time_factor", help: "Whisper processing seconds divided by audio seconds" , registers: [register] });

function startMetricsServer(queue) {
  const update = () => queue.getWaitingCount().then((count) => queueDepth.set({ queue: "transcribe" }, count)).catch(() => {});
  update();
  const timer = setInterval(update, 5000);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/metrics") { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });
  server.listen(Number(process.env.METRICS_PORT || 9102), "0.0.0.0");
  return server;
}

module.exports = { jobDurationSeconds, jobFailuresTotal, whisperRealTimeFactor, startMetricsServer };
