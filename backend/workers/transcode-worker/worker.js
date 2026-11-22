const fs = require("fs").promises;
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { Worker, Queue } = require("bullmq");
const mysql = require("mysql2/promise");
const pino = require("pino");
const { jobDurationSeconds, jobFailuresTotal, startMetricsServer } = require("./metrics");
require("dotenv").config();

const execFileAsync = promisify(execFile);
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
};
const mediaDir = process.env.MEDIA_DIR || "/media";
const uploadsDir = process.env.UPLOADS_DIR || "/uploads";
const transcribeQueue = new Queue("transcribe", { connection });
const metricsQueue = new Queue("transcode", { connection });
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "rootpassword",
  database: process.env.DB_NAME || "chunked_upload_db",
  waitForConnections: true,
  connectionLimit: 5,
});

async function fileExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

async function playlistIsValid(playlistPath) {
  if (!(await fileExists(playlistPath))) return false;

  const content = await fs.readFile(playlistPath, "utf8");
  const mediaEntries = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (mediaEntries.length === 0) return false;
  return Promise.all(
    mediaEntries.map((entry) => fileExists(path.resolve(path.dirname(playlistPath), entry)))
  ).then((results) => results.every(Boolean));
}

async function outputIsValid(outputDir) {
  const masterPath = path.join(outputDir, "master.m3u8");
  if (!(await fileExists(masterPath))) return false;

  const master = await fs.readFile(masterPath, "utf8");
  if (!master.includes("360p/index.m3u8") || !master.includes("720p/index.m3u8")) {
    return false;
  }

  return (
    (await playlistIsValid(path.join(outputDir, "360p", "index.m3u8"))) &&
    (await playlistIsValid(path.join(outputDir, "720p", "index.m3u8")))
  );
}

async function runCommand(command, args) {
  try {
    await execFileAsync(command, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const stderr = error.stderr ? `: ${error.stderr.trim()}` : "";
    throw new Error(`${command} failed${stderr}`);
  }
}

async function readDuration(inputPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error("ffprobe returned an invalid duration");
  }
  return duration;
}

async function createVariant(inputPath, outputDir, height) {
  const variantDir = path.join(outputDir, `${height}p`);
  await fs.mkdir(variantDir, { recursive: true });
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    `scale=-2:${height}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    path.join(variantDir, "segment_%05d.ts"),
    path.join(variantDir, "index.m3u8"),
  ]);
}

async function createThumbnail(inputPath, outputDir) {
  const thumbnailPath = path.join(outputDir, "thumbnail.jpg");
  if (await fileExists(thumbnailPath)) return;
  await runCommand("ffmpeg", [
    "-y",
    "-ss",
    "00:00:01",
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:-2",
    thumbnailPath,
  ]);
}

async function writeMasterPlaylist(outputDir) {
  const master = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=640x360",
    "360p/index.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720",
    "720p/index.m3u8",
    "",
  ].join("\n");
  await fs.writeFile(path.join(outputDir, "master.m3u8"), master);
}

async function markJobProcessing(videoId) {
  await pool.query(
    `UPDATE jobs
     SET status = 'processing', attempts = attempts + 1,
         started_at = NOW(), error = NULL
     WHERE video_id = ? AND stage = 'transcode'`,
    [videoId]
  );
  await pool.query("UPDATE videos SET status = 'transcoding' WHERE id = ?", [videoId]);
}

async function markJobFailed(videoId, message, finalAttempt) {
  await pool.query(
    `UPDATE jobs
     SET status = ?, error = ?, finished_at = IF(? = 'failed', NOW(), finished_at)
     WHERE video_id = ? AND stage = 'transcode'`,
    [finalAttempt ? "failed" : "queued", message, finalAttempt ? "failed" : "queued", videoId]
  );
  if (finalAttempt) {
    await pool.query("UPDATE videos SET status = 'failed' WHERE id = ?", [videoId]);
  }
}

async function processTranscode(job) {
  const { videoId, uploadId, fileName, inputPath: legacyInputPath } = job.data;
  const inputFile = fileName
    ? path.join(uploadsDir, fileName)
    : path.join(uploadsDir, path.basename(legacyInputPath));
  const outputDir = path.join(mediaDir, String(videoId));
  const maxAttempts = Number(job.opts.attempts || 3);
  const stopTimer = jobDurationSeconds.startTimer({ stage: "transcode" });

  await markJobProcessing(videoId);
  try {
    if (!(await fileExists(inputFile))) {
      throw new Error(`Input video not found: ${inputFile}`);
    }

    const duration = await readDuration(inputFile);
    await pool.query("UPDATE videos SET duration_seconds = ? WHERE id = ?", [duration, videoId]);

    if (!(await outputIsValid(outputDir))) {
      await fs.rm(outputDir, { recursive: true, force: true });
      await fs.mkdir(outputDir, { recursive: true });
      await createVariant(inputFile, outputDir, 360);
      await createVariant(inputFile, outputDir, 720);
      await writeMasterPlaylist(outputDir);
    }

    await createThumbnail(inputFile, outputDir);

    if (!(await outputIsValid(outputDir))) {
      throw new Error("Generated HLS output failed validation");
    }

    await pool.query(
      `INSERT INTO jobs (video_id, stage, status)
       VALUES (?, 'transcribe', 'queued')
       ON DUPLICATE KEY UPDATE status = IF(status = 'completed', status, 'queued')`,
      [videoId]
    );
    await transcribeQueue.add(
      "transcribe",
      { videoId, uploadId, fileName },
      { jobId: `transcribe-${videoId}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );
    await pool.query(
      `UPDATE jobs SET status = 'completed', finished_at = NOW(), error = NULL
       WHERE video_id = ? AND stage = 'transcode'`,
      [videoId]
    );
    logger.info({ videoId, duration }, "Transcode complete and transcription queued");
  } catch (error) {
    jobFailuresTotal.inc({ stage: "transcode" });
    const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
    await markJobFailed(videoId, error.message, finalAttempt);
    logger.error({ err: error, videoId, finalAttempt }, "Transcode failed");
    throw error;
  } finally {
    stopTimer();
  }
}

const worker = new Worker("transcode", processTranscode, {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY || 1),
});
const metricsServer = startMetricsServer(metricsQueue);

worker.on("completed", (job) => logger.info({ jobId: job.id }, "Transcode job completed"));
worker.on("failed", (job, error) => {
  logger.error({ jobId: job && job.id, err: error }, "Transcode job failed");
});

async function shutdown() {
  await worker.close();
  await transcribeQueue.close();
  await metricsQueue.close();
  metricsServer.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
logger.info("Transcode worker started");
