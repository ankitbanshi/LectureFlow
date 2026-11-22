const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../config/db");
const { transcodeQueue } = require("../config/queue");
const logger = require("../config/logger");
const { uploadSuccessTotal, uploadFailureTotal, hashMismatchTotal } = require("../config/metrics");

const UPLOADS_DIR = path.join(__dirname, "../uploads");
const TEMP_DIR = path.join(__dirname, "../temp");
const MEDIA_DIR = path.join(__dirname, "../media");
const finalizeLocks = new Map();

async function moveFile(source, target) {
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code === "EXDEV") {
      await fs.copyFile(source, target);
      await fs.unlink(source);
    } else {
      throw error;
    }
  }
}

async function processFinalizationInBackground(uploadId, uploadData) {
  try {
    const tempFile = path.join(TEMP_DIR, uploadId);
    const finalFile = path.join(
      UPLOADS_DIR,
      `${uploadId}_${uploadData.file_name}`
    );

    await moveFile(tempFile, finalFile);

    const hash = crypto.createHash("sha256");
    const stream = fsSync.createReadStream(finalFile);
    for await (const chunk of stream) hash.update(chunk);
    const finalHash = hash.digest("hex");

    if (finalHash !== uploadData.file_hash) {
      hashMismatchTotal.inc();
      await fs.unlink(finalFile);
      throw new Error("SHA-256 verification failed");
    }

    const connection = await pool.getConnection();
    let videoId;
    try {
      await connection.beginTransaction();
      await connection.query(
        'UPDATE uploads SET status = "COMPLETED", final_hash = ? WHERE id = ?',
        [finalHash, uploadId]
      );

      await connection.query(
        `INSERT INTO videos (upload_id, title, original_filename)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [uploadId, path.parse(uploadData.file_name).name, uploadData.file_name]
      );
      [[{ id: videoId }]] = await connection.query(
        "SELECT id FROM videos WHERE upload_id = ?",
        [uploadId]
      );

      await connection.query(
        `INSERT INTO jobs (video_id, stage)
         VALUES (?, 'transcode')
         ON DUPLICATE KEY UPDATE video_id = VALUES(video_id)`,
        [videoId]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await transcodeQueue.add(
      "transcode",
      { videoId, uploadId, fileName: path.basename(finalFile) },
      { jobId: `transcode-${videoId}` }
    );
    uploadSuccessTotal.inc();
    logger.info({ uploadId, videoId }, "Upload finalized and transcode queued");
  } catch (err) {
    uploadFailureTotal.inc();
    logger.error({ err, uploadId }, "Upload finalization failed");
    await pool.query('UPDATE uploads SET status = "FAILED" WHERE id = ?', [
      uploadId,
    ]);
  } finally {
    finalizeLocks.delete(uploadId);
  }
}

async function cleanupOrphanedUploads() {
  try {
    const [orphaned] = await pool.query(`
      SELECT id FROM uploads 
      WHERE status != 'COMPLETED' 
      AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    for (const upload of orphaned) {
      const tempFile = path.join(TEMP_DIR, upload.id);
      try {
        if (fsSync.existsSync(tempFile)) await fs.unlink(tempFile);
      } catch (err) {
        /* ignore */
      }
      await pool.query("DELETE FROM uploads WHERE id = ?", [upload.id]);
      console.log(`Cleaned up orphaned upload: ${upload.id}`);
    }
  } catch (err) {
    console.error(" Cleanup error:", err.message);
  }
}

module.exports = {
  UPLOADS_DIR,
  TEMP_DIR,
  MEDIA_DIR,
  finalizeLocks,
  moveFile,
  processFinalizationInBackground,
  cleanupOrphanedUploads,
};
