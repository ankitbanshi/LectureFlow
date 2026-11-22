const express = require("express");
const cors = require("cors");
const initialize = require("./utils/bootstrap");
const { cleanupOrphanedUploads, finalizeLocks } = require("./utils/fileHelpers");
const { MEDIA_DIR } = require("./utils/fileHelpers");
const uploadRoutes = require("./routes/uploadRoutes");
const videoRoutes = require("./routes/videoRoutes");
const pool = require("./config/db");
const { transcodeQueue, transcribeQueue, summarizeQueue } = require("./config/queue");
const { register, queueDepth } = require("./config/metrics");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3002;

app.use(express.json());
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' })); 
app.use(cors({ origin: "*" }));

app.get("/metrics", async (req, res) => {
  await Promise.all([
    ["transcode", transcodeQueue],
    ["transcribe", transcribeQueue],
    ["summarize", summarizeQueue],
  ].map(async ([name, queue]) => queueDepth.set({ queue: name }, await queue.getWaitingCount())));
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use(
  "/media",
  express.static(MEDIA_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".m3u8")) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      } else if (filePath.endsWith(".ts")) {
        res.setHeader("Content-Type", "video/mp2t");
      }
      res.setHeader("Cache-Control", "public, max-age=3600");
    },
  })
);

app.get("/", (req, res) => res.json({ status: "Running" }));
app.use("/upload", uploadRoutes);
app.use("/videos", videoRoutes);

setInterval(cleanupOrphanedUploads, 60 * 60 * 1000);
setInterval(() => {
  const now = Date.now();
  for (const [id, time] of finalizeLocks) {
    if (now - time > 10 * 60 * 1000) finalizeLocks.delete(id);
  }
}, 60 * 1000);

const shutdown = async () => {
  console.log('Server shutting down...');
  await pool.end();
  await Promise.all([transcodeQueue.close(), transcribeQueue.close(), summarizeQueue.close()]);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

initialize().then(() => {
    app.listen(port, () => console.log(`Server is running on port: ${port}`));
});