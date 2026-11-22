const { Worker, Queue } = require("bullmq");
const mysql = require("mysql2/promise");
const pino = require("pino");
const { jobDurationSeconds, jobFailuresTotal, startMetricsServer } = require("./metrics");
require("dotenv").config();

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
};
const groqApiKey = process.env.GROQ_API_KEY;
const groqModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const groqUrl = process.env.GROQ_URL || "https://api.groq.com/openai/v1/chat/completions";
const maxChunkCharacters = Number(process.env.SUMMARY_CHUNK_CHARS || 12000);
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "rootpassword",
  database: process.env.DB_NAME || "chunked_upload_db",
  waitForConnections: true,
  connectionLimit: 5,
});
const metricsQueue = new Queue("summarize", { connection });

const stopWords = new Set([
  "about", "after", "again", "also", "because", "before", "being", "between",
  "could", "from", "have", "into", "more", "other", "over", "should", "some",
  "than", "that", "their", "there", "these", "they", "this", "through", "under",
  "very", "were", "what", "when", "where", "which", "while", "with", "would",
]);

function splitIntoChunks(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let currentChunk = "";

  for (const word of words) {
    const candidate = currentChunk ? `${currentChunk} ${word}` : word;
    if (candidate.length > maxChunkCharacters && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = word;
    } else {
      currentChunk = candidate;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks.length > 0 ? chunks : ["No transcript text is available."];
}

function parseJsonContent(content) {
  const cleaned = String(content || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Groq returned invalid JSON: ${error.message}`);
  }
}

function validateInsights(value) {
  if (!value || !Array.isArray(value.summary) || !Array.isArray(value.keywords)) {
    throw new Error("Summary response must contain summary and keywords arrays");
  }
  if (value.summary.length !== 5 || value.keywords.length !== 8) {
    throw new Error("Summary response must contain exactly 5 bullets and 8 keywords");
  }
  if (
    value.summary.some((item) => typeof item !== "string" || !item.trim()) ||
    value.keywords.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error("Summary and keywords must contain non-empty strings");
  }
  return {
    summary: value.summary.map((item) => item.trim()),
    keywords: value.keywords.map((item) => item.trim()),
  };
}

function fallbackInsights(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const summary = sentences.slice(0, 5);
  while (summary.length < 5) {
    summary.push(summary[summary.length - 1] || "No additional transcript detail is available.");
  }

  const counts = new Map();
  for (const token of text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) {
    if (!stopWords.has(token)) counts.set(token, (counts.get(token) || 0) + 1);
  }
  const keywords = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, 8);
  for (const fallbackKeyword of ["lecture", "concept", "learning", "transcript", "course", "topic", "example", "review"]) {
    if (keywords.length === 8) break;
    if (!keywords.includes(fallbackKeyword)) keywords.push(fallbackKeyword);
  }

  return validateInsights({ summary, keywords });
}

async function callGroq(prompt) {
  const response = await fetch(groqUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({
      model: groqModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Return only valid JSON with exactly two fields: summary, an array of exactly 5 concise bullet strings; and keywords, an array of exactly 8 concise keyword strings.",
        },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(Number(process.env.GROQ_TIMEOUT_MS || 120000)),
  });
  if (!response.ok) {
    throw new Error(`Groq returned ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  return validateInsights(parseJsonContent(body.choices?.[0]?.message?.content));
}

async function generateInsights(text) {
  if (!groqApiKey) {
    return { ...fallbackInsights(text), provider: "extractive", model: "local" };
  }

  try {
    const chunks = splitIntoChunks(text);
    const partialInsights = [];
    for (const [index, chunk] of chunks.entries()) {
      partialInsights.push(
        await callGroq(`Summarize transcript chunk ${index + 1} of ${chunks.length}. Preserve the important facts and terms.\n\n${chunk}`)
      );
    }

    const insights = partialInsights.length === 1
      ? partialInsights[0]
      : await callGroq(`Combine these partial transcript analyses into the final lecture result.\n\n${JSON.stringify(partialInsights)}`);
    return { ...insights, provider: "groq", model: groqModel };
  } catch (error) {
    logger.warn({ err: error, model: groqModel }, "Groq unavailable; using extractive fallback");
    return { ...fallbackInsights(text), provider: "extractive-fallback", model: "local" };
  }
}

function parseStoredJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function loadExistingInsights(videoId) {
  const [rows] = await pool.query(
    "SELECT summary, keywords, provider, model FROM video_insights WHERE video_id = ?",
    [videoId]
  );
  if (rows.length === 0) return null;
  const insights = validateInsights({
    summary: parseStoredJson(rows[0].summary),
    keywords: parseStoredJson(rows[0].keywords),
  });
  return { ...insights, provider: rows[0].provider, model: rows[0].model };
}

async function markJobProcessing(videoId) {
  await pool.query(
    `UPDATE jobs
     SET status = 'processing', attempts = attempts + 1,
         started_at = NOW(), error = NULL
     WHERE video_id = ? AND stage = 'summarize'`,
    [videoId]
  );
  await pool.query("UPDATE videos SET status = 'summarizing' WHERE id = ?", [videoId]);
}

async function markJobFailed(videoId, message, finalAttempt) {
  await pool.query(
    `UPDATE jobs
     SET status = ?, error = ?, finished_at = IF(? = 'failed', NOW(), finished_at)
     WHERE video_id = ? AND stage = 'summarize'`,
    [finalAttempt ? "failed" : "queued", message, finalAttempt ? "failed" : "queued", videoId]
  );
  if (finalAttempt) await pool.query("UPDATE videos SET status = 'failed' WHERE id = ?", [videoId]);
}

async function saveInsights(videoId, insights) {
  await pool.query(
    `INSERT INTO video_insights (video_id, summary, keywords, provider, model)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       summary = VALUES(summary), keywords = VALUES(keywords),
       provider = VALUES(provider), model = VALUES(model)`,
    [
      videoId,
      JSON.stringify(insights.summary),
      JSON.stringify(insights.keywords),
      insights.provider,
      insights.model,
    ]
  );
}

async function processSummary(job) {
  const { videoId } = job.data;
  const maxAttempts = Number(job.opts.attempts || 3);
  const stopTimer = jobDurationSeconds.startTimer({ stage: "summarize" });
  await markJobProcessing(videoId);

  try {
    const [rows] = await pool.query(
      `SELECT text FROM transcript_segments
       WHERE video_id = ?
       ORDER BY start_sec, id`,
      [videoId]
    );
    const transcript = rows.map((row) => row.text).join(" ").trim();
    const insights = await loadExistingInsights(videoId) || await generateInsights(transcript);
    await saveInsights(videoId, insights);
    await pool.query(
      `UPDATE jobs SET status = 'completed', finished_at = NOW(), error = NULL
       WHERE video_id = ? AND stage = 'summarize'`,
      [videoId]
    );
    await pool.query("UPDATE videos SET status = 'ready' WHERE id = ?", [videoId]);
    logger.info({ videoId, provider: insights.provider, model: insights.model }, "Summary complete");
  } catch (error) {
    jobFailuresTotal.inc({ stage: "summarize" });
    const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
    await markJobFailed(videoId, error.message, finalAttempt);
    logger.error({ err: error, videoId, finalAttempt }, "Summary failed");
    throw error;
  } finally {
    stopTimer();
  }
}

const worker = new Worker("summarize", processSummary, {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY || 1),
});
const metricsServer = startMetricsServer(metricsQueue);

worker.on("completed", (job) => logger.info({ jobId: job.id }, "Summary job completed"));
worker.on("failed", (job, error) => logger.error({ jobId: job && job.id, err: error }, "Summary job failed"));

async function shutdown() {
  await worker.close();
  await metricsQueue.close();
  metricsServer.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
logger.info({ provider: groqApiKey ? "groq" : "extractive" }, "Summary worker started");
