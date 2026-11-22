import React from "react";
import { useChunkUpload } from "../hooks/useChunkUpload";
import { UploadBox } from "../components/UploadBox";
import { ProgressStats } from "../components/ProgressStats";
import { ChunkGrid } from "../components/ChunkGrid";
import { SuccessModal } from "../components/SuccessModal";

export function UploadPage() {
  const { startUpload, pause, resume, reset, status, chunks, progress, metrics, successData, fileName, isOnline, activeCount } = useChunkUpload();
  return (
    <section className="upload-page">
      <div className="upload-wrapper">
        <p className="eyebrow">LECTURE INGESTION</p>
        <h1 className="title">Bring your lecture to life.</h1>
        <p className="subtitle">Upload a video and LectureFlow will prepare adaptive playback, transcript, and insights.</p>
        <UploadBox onFileSelect={startUpload} disabled={status === "UPLOADING" || status === "FINALIZING"} fileName={fileName} />
        {status !== "IDLE" && status !== "HASHING" && (
          <>
            <ProgressStats progress={progress} speed={metrics.speed} eta={metrics.eta} status={status} onPause={pause} onResume={resume} onCancel={reset} isOnline={isOnline} activeCount={activeCount} />
            <ChunkGrid chunks={chunks} />
          </>
        )}
      </div>
      {successData && <SuccessModal data={successData} onClose={reset} />}
    </section>
  );
}
