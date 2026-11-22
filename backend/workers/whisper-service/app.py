import importlib.metadata
import os
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException
from faster_whisper import WhisperModel
from pydantic import BaseModel

MODEL_NAME = os.getenv("WHISPER_MODEL", "tiny")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", "/media")).resolve()
MODEL_VERSION = importlib.metadata.version("faster-whisper")
model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)

app = FastAPI(title="LectureFlow Whisper Service")


class TranscribeRequest(BaseModel):
    video_path: str


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscribeResponse(BaseModel):
    segments: List[TranscriptSegment]
    model_name: str
    model_version: str


@app.get("/health")
def health():
    return {"status": "ok", "model_name": MODEL_NAME, "model_version": MODEL_VERSION}


@app.post("/transcribe", response_model=TranscribeResponse)
def transcribe(request: TranscribeRequest):
    requested_path = Path(request.video_path).resolve()
    if MEDIA_DIR not in requested_path.parents:
        raise HTTPException(status_code=400, detail="video_path must be inside the media volume")
    if not requested_path.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        whisper_segments, _ = model.transcribe(
            str(requested_path),
            beam_size=5,
            vad_filter=True,
        )
        segments = [
            TranscriptSegment(
                start=round(segment.start, 3),
                end=round(segment.end, 3),
                text=segment.text.strip(),
            )
            for segment in whisper_segments
            if segment.text.strip()
        ]
        return TranscribeResponse(
            segments=segments,
            model_name=MODEL_NAME,
            model_version=MODEL_VERSION,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
