const pool = require("../config/db");

exports.listVideos = async (req, res) => {
  try {
    const [videos] = await pool.query(
      `SELECT id, upload_id, title, original_filename, status,
              duration_seconds, model_version, created_at,
              CONCAT('/media/', id, '/master.m3u8') AS hls_url,
              CONCAT('/media/', id, '/thumbnail.jpg') AS thumbnail_url
       FROM videos
       ORDER BY created_at DESC`
    );
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getVideo = async (req, res) => {
  try {
    const [videos] = await pool.query(
      `SELECT id, upload_id, title, original_filename, status,
              duration_seconds, model_version, created_at,
              CONCAT('/media/', id, '/master.m3u8') AS hls_url,
              CONCAT('/media/', id, '/thumbnail.jpg') AS thumbnail_url
       FROM videos
       WHERE id = ?`,
      [req.params.id]
    );

    if (videos.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    const [insights] = await pool.query(
      `SELECT summary, keywords, provider, model
       FROM video_insights
       WHERE video_id = ?`,
      [req.params.id]
    );

    res.json({
      ...videos[0],
      insights: insights[0]
        ? {
            summary: typeof insights[0].summary === "string" ? JSON.parse(insights[0].summary) : insights[0].summary,
            keywords: typeof insights[0].keywords === "string" ? JSON.parse(insights[0].keywords) : insights[0].keywords,
            provider: insights[0].provider,
            model: insights[0].model,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.searchTranscript = async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const [segments] = query
      ? await pool.query(
          `SELECT id, start_sec, end_sec, text
           FROM transcript_segments
           WHERE video_id = ? AND MATCH(text) AGAINST (? IN NATURAL LANGUAGE MODE)
           ORDER BY start_sec`,
          [req.params.id, query]
        )
      : await pool.query(
          `SELECT id, start_sec, end_sec, text
           FROM transcript_segments
           WHERE video_id = ?
           ORDER BY start_sec`,
          [req.params.id]
        );
    res.json(segments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};