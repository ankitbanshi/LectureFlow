const fs = require("fs").promises;
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { Worker, Queue } = require("bullmq");
const mysql = require("mysql2/promise");
const pino = require("pino");
const { jobDurationSeconds, jobFailuresTotal, whisperRealTimeFactor, startMetricsServer } = require("./metrics");
require("dotenv").config();

const execFileAsync = promisify(execFile);
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
};
const mediaDir = process.env.MEDIA_DIR || "/media";
const uploadsDir = process.env.UPLOADS_DIR || "/uploads";
const whisperUrl = process.env.WHISPER_URL || "http://whisper-service:8000";
const summarizeQueue = new Queue("summarize", { connection });
const metricsQueue = new Queue("transcribe", { connection });
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
    return stats.isFile() && stats.size > 44;
  } catch {
    return false;
  }
}

async function runCommand(command, args) {
  try {
    await execFileAsync(command, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const stderr = error.stderr ? `: ${error.stderr.trim()}` : "";
    throw new Error(`${command} failed${stderr}`);
  }
}

async function getVideoSource(videoId, jobData) {
  if (jobData.uploadId && jobData.fileName) {
    return path.join(uploadsDir, jobData.fileName);
  }

  const [videos] = await pool.query(
    `SELECT upload_id, original_filename
     FROM videos
     WHERE id = ?`,
    [videoId]
  );
  if (videos.length === 0) throw new Error(`Video ${videoId} not found`);
  return path.join(uploadsDir, `${videos[0].upload_id}_${videos[0].original_filename}`);
}

async function extractAudio(inputPath, audioPath) {
  if (await fileExists(audioPath)) return;

  await fs.mkdir(path.dirname(audioPath), { recursive: true });
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    audioPath,
  ]);
}

async function requestTranscript(audioPath) {
  const response = await fetch(`${whisperUrl}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_path: audioPath }),
    signal: AbortSignal.timeout(Number(process.env.WHISPER_TIMEOUT_MS || 3600000)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Whisper service returned ${response.status}: ${body}`);
  }
  return response.json();
}

async function readAudioDuration(audioPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", audioPath,
  ]);
  return Number.parseFloat(stdout.trim());
}

async function markJobProcessing(videoId) {
  await pool.query(
    `UPDATE jobs
     SET status = 'processing', attempts = attempts + 1,
         started_at = NOW(), error = NULL
     WHERE video_id = ? AND stage = 'transcribe'`,
    [videoId]
  );
  await pool.query("UPDATE videos SET status = 'transcribing' WHERE id = ?", [videoId]);
}

async function markJobFailed(videoId, message, finalAttempt) {
  await pool.query(
    `UPDATE jobs
     SET status = ?, error = ?, finished_at = IF(? = 'failed', NOW(), finished_at)
     WHERE video_id = ? AND stage = 'transcribe'`,
    [finalAttempt ? "failed" : "queued", message, finalAttempt ? "failed" : "queued", videoId]
  );
  if (finalAttempt) {
    await pool.query("UPDATE videos SET status = 'failed' WHERE id = ?", [videoId]);
  }
}

async function saveTranscript(videoId, transcript) {
  const connectionHandle = await pool.getConnection();
  try {
    await connectionHandle.beginTransaction();
    await connectionHandle.query("DELETE FROM transcript_segments WHERE video_id = ?", [videoId]);

    const segments = (transcript.segments || [])
      .filter((segment) => Number.isFinite(Number(segment.start)) && Number.isFinite(Number(segment.end)))
      .map((segment) => [videoId, Number(segment.start), Number(segment.end), String(segment.text || "").trim()])
      .filter((segment) => segment[3]);

    if (segments.length > 0) {
      await connectionHandle.query(
        "INSERT INTO transcript_segments (video_id, start_sec, end_sec, text) VALUES ?",
        [segments]
      );
    }

    await connectionHandle.query(
      `UPDATE videos
       SET model_version = ?, status = 'transcribing'
       WHERE id = ?`,
      [`${transcript.model_name}@${transcript.model_version}`, videoId]
    );
    await connectionHandle.commit();
  } catch (error) {
    await connectionHandle.rollback();
    throw error;
  } finally {
    connectionHandle.release();
  }
}

async function processTranscription(job) {
  const { videoId } = job.data;
  const maxAttempts = Number(job.opts.attempts || 3);
  const audioPath = path.join(mediaDir, String(videoId), "audio.wav");
  const stopTimer = jobDurationSeconds.startTimer({ stage: "transcribe" });

  await markJobProcessing(videoId);
  try {
    const inputPath = await getVideoSource(videoId, job.data);
    await extractAudio(inputPath, audioPath);
    const whisperStart = Date.now();
    const transcript = await requestTranscript(audioPath);
    const audioDuration = await readAudioDuration(audioPath);
    if (audioDuration > 0) whisperRealTimeFactor.set((Date.now() - whisperStart) / 1000 / audioDuration);
    await saveTranscript(videoId, transcript);

    await pool.query(
      `INSERT INTO jobs (video_id, stage, status)
       VALUES (?, 'summarize', 'queued')
       ON DUPLICATE KEY UPDATE status = IF(status = 'completed', status, 'queued')`,
      [videoId]
    );
    await summarizeQueue.add(
      "summarize",
      { videoId },
      { jobId: `summarize-${videoId}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );
    await pool.query(
      `UPDATE jobs SET status = 'completed', finished_at = NOW(), error = NULL
       WHERE video_id = ? AND stage = 'transcribe'`,
      [videoId]
    );
    logger.info({ videoId, modelVersion: transcript.model_version }, "Transcription complete and summary queued");
  } catch (error) {
    jobFailuresTotal.inc({ stage: "transcribe" });
    const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
    await markJobFailed(videoId, error.message, finalAttempt);
    logger.error({ err: error, videoId, finalAttempt }, "Transcription failed");
    throw error;
  } finally {
    stopTimer();
  }
}

const worker = new Worker("transcribe", processTranscription, {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY || 1),
});
const metricsServer = startMetricsServer(metricsQueue);

worker.on("completed", (job) => logger.info({ jobId: job.id }, "Transcription job completed"));
worker.on("failed", (job, error) => {
  logger.error({ jobId: job && job.id, err: error }, "Transcription job failed");
});

async function shutdown() {
  await worker.close();
  await summarizeQueue.close();
  await metricsQueue.close();
  metricsServer.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
logger.info("Transcription worker started");
