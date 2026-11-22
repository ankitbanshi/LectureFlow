const fs = require("fs").promises;
const pool = require("../config/db");
const {
  UPLOADS_DIR,
  TEMP_DIR,
  MEDIA_DIR,
  cleanupOrphanedUploads,
} = require("./fileHelpers");

async function initialize() {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS uploads (
          id VARCHAR(255) PRIMARY KEY,
          file_name VARCHAR(500) NOT NULL,
          file_hash VARCHAR(64) NOT NULL,
          file_size BIGINT NOT NULL,
          total_chunks INT NOT NULL,
          status ENUM('UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED') DEFAULT 'UPLOADING',
          final_hash VARCHAR(64),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_hash (file_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS chunks (
          id INT AUTO_INCREMENT PRIMARY KEY,
          upload_id VARCHAR(255) NOT NULL,
          chunk_index INT NOT NULL,
          chunk_size INT NOT NULL,
          status ENUM('PENDING', 'RECEIVED', 'FAILED') DEFAULT 'PENDING',
          received_at TIMESTAMP NULL,
          UNIQUE KEY unique_chunk (upload_id, chunk_index),
          FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS videos (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          upload_id VARCHAR(255) NOT NULL,
          title VARCHAR(500) NOT NULL,
          original_filename VARCHAR(500) NOT NULL,
          status ENUM('uploaded', 'transcoding', 'transcribing', 'summarizing', 'ready', 'failed') NOT NULL DEFAULT 'uploaded',
          duration_seconds DECIMAL(10, 3) NULL,
          model_version VARCHAR(100) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_video_upload (upload_id),
          CONSTRAINT fk_videos_upload FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      try {
        await connection.query(
          "ALTER TABLE videos ADD COLUMN model_version VARCHAR(100) NULL"
        );
      } catch (error) {
        if (error.code !== "ER_DUP_FIELDNAME") throw error;
      }

      await connection.query(`
        CREATE TABLE IF NOT EXISTS jobs (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          video_id BIGINT NOT NULL,
          stage VARCHAR(50) NOT NULL,
          status ENUM('queued', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'queued',
          attempts INT NOT NULL DEFAULT 0,
          error TEXT NULL,
          started_at TIMESTAMP NULL,
          finished_at TIMESTAMP NULL,
          UNIQUE KEY unique_video_stage (video_id, stage),
          CONSTRAINT fk_jobs_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS transcript_segments (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          video_id BIGINT NOT NULL,
          start_sec DECIMAL(10, 3) NOT NULL,
          end_sec DECIMAL(10, 3) NOT NULL,
          text TEXT NOT NULL,
          FULLTEXT KEY ft_transcript_text (text),
          UNIQUE KEY unique_transcript_segment (video_id, start_sec, end_sec),
          CONSTRAINT fk_transcript_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS video_insights (
          video_id BIGINT PRIMARY KEY,
          summary JSON NOT NULL,
          keywords JSON NOT NULL,
          provider VARCHAR(50) NOT NULL,
          model VARCHAR(100) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_insights_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } finally {
      connection.release();
    }

    await cleanupOrphanedUploads();
    console.log("✓ Server initialized & DB verified");
  } catch (err) {
    console.error(" Initialization error:", err.message);
    process.exit(1);
  }
}

module.exports = initialize;
