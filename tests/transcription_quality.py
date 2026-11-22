import os
import sys
import time
from pathlib import Path

import requests
from jiwer import wer


service_url = os.getenv("WHISPER_URL", "http://localhost:8000")
audio_path = Path(__file__).parent / "audio" / "sample.wav"
reference_path = Path(__file__).parent / "transcription_reference.txt"
threshold = float(os.getenv("WHISPER_WER_THRESHOLD", "0.45"))

for _ in range(60):
    try:
        response = requests.get(f"{service_url}/health", timeout=5)
        if response.ok:
            break
    except requests.RequestException:
        pass
    time.sleep(5)
else:
    raise RuntimeError("Whisper service did not become healthy")

response = requests.post(
    f"{service_url}/transcribe",
    json={"video_path": "/media/sample.wav"},
    timeout=300,
)
response.raise_for_status()
payload = response.json()
hypothesis = " ".join(segment["text"] for segment in payload["segments"])
reference = reference_path.read_text(encoding="utf-8").strip()
score = wer(reference, hypothesis)
print(f"model={payload['model_name']}@{payload['model_version']}")
print(f"reference={reference!r}")
print(f"hypothesis={hypothesis!r}")
print(f"wer={score:.4f}, threshold={threshold:.4f}")
if score > threshold:
    sys.exit(1)