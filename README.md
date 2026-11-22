# Resilient Chunked File Uploader

A robust, production-ready file uploader built with **React**, **Node.js**, and **MySQL**. It supports **chunked uploads**, **automatic retries**, **pause/resume capabilities**, and **resiliency** against network failures and server crashes.

---

## ✨ Features

- **Chunked Uploading**: Splits large video files into 5MB chunks to bypass server limits and ensure reliability.
- **Pause & Resume**: Stop uploads and resume exactly where you left off, even after a page refresh.
- **Fault Tolerance**: Automatically retries failed chunks and handles network interruptions gracefully.
- **Concurrent Uploading**: Uploads 3 chunks in parallel for maximum speed.
- **Data Integrity**: Verifies SHA-256 hashes on both client and server to ensure file corruption protection.
- **Dockerized**: Full `docker-compose` setup for one-command deployment.
- **Cross-Volume Support**: Handles file moves across Docker volumes gracefully (fixes `EXDEV` errors).

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React (Vite)
- **Styling**: CSS3 (Responsive)
- **HTTP Client**: Axios (with AbortController for cancellation)

### Backend
- **Runtime**: Node.js (Express)
- **Database**: MySQL (using `mysql2` with connection pooling)
- **File Handling**: Native `fs` streams
- **Processing Queue**: BullMQ backed by Redis

---

## 🚀 Getting Started (Docker)

The easiest way to run the application is using Docker Compose.

### Prerequisites
- Docker & Docker Compose installed

### Steps

1. **Clone the repository:**
```bash
   git clone https://github.com/ankitbanshi/LectureFlow.git
   cd LectureFlow
```

2. **Create a `.env` file in the repository root:**
```env
MYSQL_ROOT_PASSWORD=choose-a-root-password
DB_USER=viz_user
DB_PASSWORD=choose-a-db-password
DB_NAME=vizexperts_db
DB_EXTERNAL_PORT=3307
BACKEND_PORT=3002
FRONTEND_PORT=5173
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile
WHISPER_MODEL=tiny
```

3. **Run with Docker Compose:**
```bash
   docker compose up --build
```

4. **Access the App:**
   - **Frontend**: [http://localhost:5173](http://localhost:5173)
   - **Backend**: [http://localhost:3002](http://localhost:3002)
   - **Database**: [localhost:3307](localhost:3307) on the host
   - **Prometheus**: [http://localhost:9090](http://localhost:9090)
   - **Grafana**: [http://localhost:3001](http://localhost:3001)

---

## 💻 Manual Setup (Local Development)

If you prefer running without Docker:

### 1. Database Setup

Ensure you have a MySQL instance running:
```sql
CREATE DATABASE vizexperts_db;
CREATE USER 'viz_user'@'localhost' IDENTIFIED BY 'choose-a-db-password';
GRANT ALL PRIVILEGES ON vizexperts_db.* TO 'viz_user'@'localhost';
FLUSH PRIVILEGES;
```

> The backend will automatically create tables on startup.

### 2. Backend Setup
```bash
cd backend
npm install
```

Create a `.env` file in the repository root (recommended) or `backend` folder:
```env
PORT=3002
DB_HOST=localhost
DB_PORT=3306
DB_USER=viz_user
DB_PASSWORD=choose-a-db-password
DB_NAME=vizexperts_db
REDIS_HOST=localhost
REDIS_PORT=6379
```

Start the server:
```bash
npm run dev
```

### 3. Frontend Setup
```bash
cd frontend
npm install
```

Create a `.env` file in the `frontend` folder:
```env
VITE_BACKEND_URL=http://localhost:3002
```

Start the client:
```bash
npm run dev
```

---

## 📡 API Endpoints

| Method | Endpoint            | Description                                                                                     |
|--------|---------------------|-------------------------------------------------------------------------------------------------|
| GET    | `/upload/status`    | Checks if a file has been partially uploaded. Returns missing chunk indexes.                    |
| POST   | `/upload/chunk`     | Receives a binary chunk. Headers: `x-upload-id`, `x-chunk-index`, `x-chunk-start`.             |
| POST   | `/upload/finalize`  | Triggered when all chunks are sent. Reassembles the file and verifies hash.                     |
| GET    | `/videos`            | Lists finalized lecture videos and their processing status.                                     |
| GET    | `/videos/:id`        | Returns one finalized lecture video.                                                            |

---

## 📂 Project Structure
```
LectureFlow/
├── docker-compose.yml       # Orchestration
├── backend/
│   ├── index.js            # Main server logic
│   ├── Dockerfile
│   ├── uploads/            # Final assembled files
│   └── temp/               # Temporary partial chunks
└── frontend/
    ├── src/
    │   ├── App.jsx         # Main UI & Upload Logic
    │   └── App.css         # Styling
    └── Dockerfile
```

---

## 🐛 Troubleshooting: Common Issues

### 1. `EXDEV: cross-device link not permitted`

- **Cause**: Docker volumes for `/temp` and `/uploads` are on different virtual filesystems.
- **Fix**: The backend uses a custom `moveFile` helper that detects this error and automatically switches to a "Copy & Delete" strategy.

### 2. `409 Conflict` on Finalization

- **Cause**: The frontend sends the "Finalize" request multiple times.
- **Fix**: The backend is idempotent; it detects if a file is already being processed and returns a `200 OK` success message instead of an error.

### 3. Database Connection Failed

- **Fix**: Ensure the `DB_HOST` in `.env` matches your setup. Use `localhost` for manual runs and `chunk_db` (service name) for Docker.

---