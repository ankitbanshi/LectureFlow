import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { mediaUrl, videoService } from "../api/videoService";

const statusLabels = { uploaded: "Queued", transcoding: "Transcoding", transcribing: "Transcribing", summarizing: "Summarizing", ready: "Ready", failed: "Failed" };

export function LibraryPage() {
  const [videos, setVideos] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { data } = await videoService.list();
        if (active) { setVideos(data); setError(""); }
      } catch { if (active) setError("Library is temporarily unavailable."); }
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return (
    <section className="library-page">
      <div className="section-heading"><div><p className="eyebrow">YOUR ARCHIVE</p><h1>Lecture library</h1></div><span className="library-count">{videos.length} {videos.length === 1 ? "lecture" : "lectures"}</span></div>
      {error && <p className="inline-error">{error}</p>}
      {!error && videos.length === 0 && <div className="empty-state"><span className="empty-mark">＋</span><h2>Your library is quiet.</h2><p>Upload a lecture to start building your searchable archive.</p><Link className="btn btn-primary" to="/upload">Upload lecture</Link></div>}
      <div className="video-grid">
        {videos.map((video) => (
          <Link className="video-card" to={`/watch/${video.id}`} key={video.id}>
            <div className="thumbnail-wrap"><img src={mediaUrl(video.thumbnail_url)} alt="" /><span className={`status-badge status-${video.status}`}>{statusLabels[video.status] || video.status}</span></div>
            <div className="video-card-body"><h2>{video.title}</h2><p>{video.original_filename}</p>{video.duration_seconds && <span className="duration">{Math.round(Number(video.duration_seconds) / 60)} min</span>}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
