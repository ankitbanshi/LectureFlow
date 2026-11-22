FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

ENV WHISPER_MODEL=tiny
ENV WHISPER_COMPUTE_TYPE=int8
ENV WHISPER_DEVICE=cpu

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
