import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Hls from "hls.js";
import { mediaUrl, videoService } from "../api/videoService";

export function WatchPage() {
  const { id } = useParams();
  const videoRef = useRef(null);
  const [video, setVideo] = useState(null);
  const [segments, setSegments] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    videoService.get(id).then(({ data }) => setVideo(data)).catch(() => setError("This lecture could not be loaded."));
  }, [id]);

  useEffect(() => {
    if (!video?.hls_url || !videoRef.current) return undefined;
    const element = videoRef.current;
    const source = mediaUrl(video.hls_url);
    let hls;
    if (element.canPlayType("application/vnd.apple.mpegurl")) element.src = source;
    else if (Hls.isSupported()) { hls = new Hls({ enableWorker: true }); hls.loadSource(source); hls.attachMedia(element); }
    return () => { hls?.destroy(); element.removeAttribute("src"); element.load(); };
  }, [video?.hls_url]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try { const { data } = await videoService.searchTranscript(id, query); setSegments(data); } catch { setSegments([]); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [id, query]);

  const seekTo = (seconds) => { if (videoRef.current) { videoRef.current.currentTime = Number(seconds); videoRef.current.play(); } };
  if (error) return <section className="empty-state"><h2>{error}</h2><Link to="/library">Back to library</Link></section>;
  if (!video) return <section className="loading-state">Loading lecture...</section>;

  return (
    <section className="watch-page">
      <Link className="back-link" to="/library">← Library</Link>
      <div className="watch-heading"><div><p className="eyebrow">NOW PLAYING</p><h1>{video.title}</h1><p>{video.original_filename}</p></div><span className={`status-badge status-${video.status}`}>{video.status}</span></div>
      <div className="watch-layout">
        <div className="player-column"><div className="player-frame"><video ref={videoRef} controls poster={mediaUrl(video.thumbnail_url)} /></div><div className="transcript-panel"><div className="panel-heading"><h2>Transcript</h2><span>{segments.length ? `${segments.length} ${query ? "matches" : "segments"}` : "No transcript yet"}</span></div><input className="search-input" type="search" placeholder="Search transcript..." value={query} onChange={(event) => setQuery(event.target.value)} />{query && segments.length === 0 ? <p className="muted">No matching moments found.</p> : <div className="segment-list">{segments.map((segment) => <button className="segment-row" key={segment.id} onClick={() => seekTo(segment.start_sec)}><time>{formatTime(segment.start_sec)}</time><span>{segment.text}</span></button>)}</div>}</div></div>
        <aside className="insights-panel"><p className="eyebrow">LECTURE NOTES</p><h2>Summary</h2>{video.insights?.summary?.length ? <ul className="summary-list">{video.insights.summary.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">Insights will appear when processing finishes.</p>}<h2 className="keywords-title">Keywords</h2><div className="keyword-list">{video.insights?.keywords?.map((keyword) => <span key={keyword}>{keyword}</span>)}</div></aside>
      </div>
    </section>
  );
}

function formatTime(value) { const seconds = Math.max(0, Math.floor(Number(value))); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
