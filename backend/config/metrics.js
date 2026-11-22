const client = require("prom-client");

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const uploadSuccessTotal = new client.Counter({
  name: "upload_success_total",
  help: "Number of uploads that passed SHA-256 verification",
  registers: [register],
});
const uploadFailureTotal = new client.Counter({
  name: "upload_failure_total",
  help: "Number of failed upload finalizations",
  registers: [register],
});
const chunkRetryTotal = new client.Counter({
  name: "chunk_retry_total",
  help: "Number of chunk receive failures eligible for client retry",
  registers: [register],
});
const hashMismatchTotal = new client.Counter({
  name: "hash_mismatch_total",
  help: "Number of full-file SHA-256 mismatches",
  registers: [register],
});
const queueDepth = new client.Gauge({
  name: "queue_depth",
  help: "Current BullMQ waiting job count",
  labelNames: ["queue"],
  registers: [register],
});

module.exports = {
  register,
  uploadSuccessTotal,
  uploadFailureTotal,
  chunkRetryTotal,
  hashMismatchTotal,
  queueDepth,
};
