# LectureFlow

LectureFlow is a resilient video upload and lecture-processing platform built with React, Node.js, MySQL, Redis, and Docker.

It supports resumable chunked uploads for 1 GB+ files, verifies file integrity with SHA-256 hashes, transcodes videos into adaptive HLS streams, generates transcripts and searchable timestamps, and produces AI-generated lecture summaries.

## Key Features

- Resumable chunked uploads for 1 GB+ video files
- Automatic chunk retries and configurable concurrent uploads
- Pause/resume support across page refreshes
- SHA-256 integrity verification on the client and server
- FFmpeg HLS transcoding at 360p and 720p
- Whisper-based speech-to-text transcription
- Groq-powered lecture summaries
- Timestamped, searchable transcripts
- Adaptive HLS playback in React
- BullMQ workers for asynchronous processing
- MySQL metadata and processing state
- Redis-backed job queues
- Prometheus metrics and Grafana dashboards
- Docker Compose deployment for AWS EC2 and containerized environments
- Optional S3-compatible storage integration for deployments

## Architecture

```text
React / Vite
     |
     | Chunked upload API
     v
Node.js / Express
     |
     +--> MySQL: uploads, videos, jobs, transcripts, insights
     |
     +--> Redis / BullMQ
              |
              +--> Transcode Worker --> FFmpeg --> HLS 360p / 720p
              +--> Transcribe Worker -> Whisper --> transcript segments
              +--> Summary Worker -----> Groq ------> lecture summary
```

## Processing Pipeline

1. The React client splits a video into chunks and uploads them concurrently.
2. The backend stores chunk state and validates the final SHA-256 hash.
3. BullMQ queues the completed video for transcoding.
4. FFmpeg creates adaptive HLS 360p and 720p outputs.
5. The transcribe worker extracts audio and sends it to Whisper.
6. The summary worker sends the transcript to Groq and stores the result.
7. The React library displays processing status, playback, transcript search, and lecture notes.

## Tech Stack

### Frontend

- React 19
- Vite
- React Router
- Axios
- HLS.js
- `hash-wasm`

### Backend

- Node.js
- Express
- MySQL 8
- Redis
- BullMQ
- MySQL2
- Prometheus `prom-client`

### Video and AI Processing

- FFmpeg and FFprobe
- Whisper HTTP service
- Groq API

### Infrastructure

- Docker and Docker Compose
- Prometheus
- Grafana
- AWS EC2-compatible deployment
- S3-compatible object-storage ready

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ for manual development
- MySQL 8+ for manual development
- Redis 7+ for manual development
- FFmpeg and FFprobe for local worker execution
- Docker Desktop on Windows

## Docker Deployment

1. Clone the repository:

```bash
git clone https://github.com/ankitbanshi/LectureFlow.git
cd LectureFlow
```

2. Create a repository-root `.env` file:

```env
MYSQL_ROOT_PASSWORD=change-me
DB_USER=lectureflow
DB_PASSWORD=change-me
DB_NAME=lectureflow
DB_EXTERNAL_PORT=3307
BACKEND_PORT=3002
FRONTEND_PORT=5173

REDIS_EXTERNAL_PORT=6379
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile
WHISPER_MODEL=tiny

PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=change-me
```

Do not commit `.env` files or API keys.

3. Build and start all services:

```bash
docker compose up --build -d
```

4. Open the application:

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3002 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 |
| MySQL | localhost:3307 |

To view service logs:

```bash
docker compose logs -f
```

To stop the application:

```bash
docker compose down
```

## Manual Development

### 1. Create the MySQL database

```sql
CREATE DATABASE lectureflow;
CREATE USER 'lectureflow'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON lectureflow.* TO 'lectureflow'@'localhost';
FLUSH PRIVILEGES;
```

The backend creates or updates the required tables at startup.

### 2. Configure and start Redis

Start Redis on `localhost:6379`, or update `REDIS_HOST` and `REDIS_PORT`.

### 3. Start the backend

```bash
cd backend
npm install
```

Create `backend/.env` or use a repository-root `.env`:

```env
PORT=3002
DB_HOST=localhost
DB_PORT=3306
DB_USER=lectureflow
DB_PASSWORD=change-me
DB_NAME=lectureflow
REDIS_HOST=localhost
REDIS_PORT=6379
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile
```

Start the API:

```bash
npm run dev
# or
npm start
```

### 4. Start the workers

Workers are designed to run in Docker Compose. For manual worker development, install FFmpeg and run each worker directory's package scripts with its required environment variables.

### 5. Start the frontend

```bash
cd frontend
npm install
```

Create `frontend/.env`:

```env
VITE_BACKEND_URL=http://localhost:3002
```

Start Vite:

```bash
npm run dev
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | API health/status response |
| `GET` | `/metrics` | Prometheus application and queue metrics |
| `GET` | `/upload/status` | Returns received chunks for an upload |
| `POST` | `/upload/chunk` | Uploads one binary chunk |
| `POST` | `/upload/finalize` | Verifies and finalizes an upload |
| `GET` | `/videos` | Lists videos and processing state |
| `GET` | `/videos/:id` | Returns video details |
| `GET` | `/media/...` | Serves HLS playlists and media segments |

Chunk requests include `x-upload-id`, `x-chunk-index`, and `x-chunk-start` headers.

## Monitoring

The backend exports queue depth and worker metrics for Prometheus. Prometheus scrapes the backend and worker metric endpoints, while Grafana provides a preconfigured LectureFlow dashboard.

Monitored data includes:

- Transcode, transcription, and summary queue depth
- Worker job duration and failures
- Whisper real-time factor
- Backend processing state

## Project Structure

```text
LectureFlow/
├── docker-compose.yml
├── backend/
│   ├── server.js
│   ├── config/
│   ├── controllers/
│   ├── routes/
│   ├── utils/
│   ├── tests/
│   ├── uploads/
│   ├── temp/
│   └── workers/
│       ├── transcode-worker/
│       ├── transcribe-worker/
│       ├── summarize-worker/
│       └── whisper-service/
├── frontend/
│   └── src/
│       ├── api/
│       ├── components/
│       ├── hooks/
│       ├── pages/
│       └── utils/
├── monitoring/
│   ├── prometheus.yml
│   └── grafana/
└── tests/
```

## Troubleshooting

### Docker Desktop is unavailable

Start Docker Desktop and wait until `docker version` reports both client and server information.

### Database access is denied

For manual development, verify `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in the loaded `.env`.

- Manual backend: use `DB_HOST=localhost`
- Docker backend: use `DB_HOST=db`
- Local host connection to the Docker database: use port `DB_EXTERNAL_PORT`, such as `3307`

### Redis connection fails

For Docker, Redis is available to services as `redis:6379`. For manual development, start a local Redis instance or set `REDIS_HOST` and `REDIS_PORT`.

### HLS playback does not work

Confirm FFmpeg produced `master.m3u8`, `360p/index.m3u8`, and `720p/index.m3u8`. Verify the `/media` route and Docker media volume.

### Docker ports are already in use

Change `BACKEND_PORT`, `FRONTEND_PORT`, `DB_EXTERNAL_PORT`, `PROMETHEUS_PORT`, or `GRAFANA_PORT` in `.env`.
