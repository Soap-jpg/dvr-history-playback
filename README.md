# DVR History Playback System

A professional-grade, full-stack DVR (Digital Video Recorder) system built with **Node.js + FFmpeg** on the backend and **React + Vite + HLS.js** on the frontend. Designed to simulate and demonstrate a real-world security camera recording and playback pipeline.

## Features

- **Live Dual-Camera Streaming** — Two synchronized camera feeds served over HLS (HTTP Live Streaming) via FFmpeg
- **Clickable 24-Hour Timeline** — Interactive timeline bar spanning the full day; click any recorded block to instantly seek both cameras to that point in history
- **Continuous Auto-Play** — Seamless playback across fragmented HLS segments with `#EXT-X-DISCONTINUITY` handling to skip gaps without freezing
- **Master Play/Pause Control** — Synchronizes both camera feeds at the exact same millisecond
- **Skip Forward / Backward (10s)** — Precision scrubbing that requests fresh HLS playlists from the backend (not `currentTime` manipulation)
- **Smart Live Detection** — Pausing the live feed auto-drops the LIVE badge and shows a "JUMP TO LIVE" button; resuming fetches a fresh live playlist at the true live edge
- **Absolute Timestamp Sync** — `#EXT-X-PROGRAM-DATE-TIME` injected per segment so the UI clock and timeline playhead stay perfectly locked to the actual video content
- **Automatic Retention Cleanup** — Old segments purged on a schedule via a dedicated worker thread
- **Minute Preview Clips** — Auto-generated `.mp4` previews per minute for fast thumbnail scrubbing
- **Docker Support** — Full `docker-compose.yml` with Nginx reverse proxy for production deployment

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, FFmpeg |
| Frontend | React, TypeScript, Vite, HLS.js |
| Styling | Tailwind CSS |
| Streaming | HLS (fMP4 segments) |
| Proxy | Nginx (Docker) |

## Project Structure

```
dvr/
├── backend/
│   ├── server.js           # Core DVR engine (FFmpeg, HLS, API routes)
│   ├── cleanup-worker.js   # Retention cleanup worker thread
│   ├── config.json         # Camera configuration (gitignored)
│   ├── config.example.json # Config template
│   └── dvr_data/           # Generated HLS segments (gitignored)
├── frontend/
│   ├── src/
│   │   └── components/
│   │       └── DVRPlayback.tsx  # Main React DVR dashboard
│   ├── vite.config.ts
│   └── package.json
├── infrastructure/
│   └── nginx.conf          # Nginx reverse proxy config
├── docker-compose.yml
└── README.md
```

## Quick Start (Local Development)

### 1. Backend Setup

```bash
cd backend
cp config.example.json config.json
# Edit config.json to point cameras at your video source(s)
npm install
node server.js
```

Backend runs on `http://localhost:8080`

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`

### 3. Add a Video Source

In `backend/config.json`, point the `source` field to a local `.mp4` file or an RTSP stream:

```json
{
  "cameras": [
    {
      "name": "cam-1",
      "source": "./traffic_mock.mp4",
      "retentionDays": 1
    },
    {
      "name": "cam-2",
      "source": "./backyard.mp4",
      "retentionDays": 1
    }
  ]
}
```

> **Note:** Video files are ignored by `.gitignore`. Place `.mp4` files directly in the `backend/` folder.

## Docker Deployment

```bash
docker-compose up --build
```

- Nginx serves on port `8080`
- Backend and frontend communicate internally via Docker network
- DVR segments are shared between the backend and Nginx via a named volume

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/:camera/live.m3u8` | Live HLS playlist (last N segments) |
| `GET` | `/:camera/index-:timestamp-:duration.m3u8` | VOD history playlist from unix timestamp |
| `GET` | `/:camera/recording_status.json` | Returns recorded time ranges for timeline |
| `GET` | `/:camera/ai_events.json` | Mocked AI event detections |
| `GET` | `/dvr/:camera/...` | Direct static file access for HLS segments |

## Configuration Reference

See [`config.example.json`](./backend/config.example.json) for all options.

| Key | Description |
|---|---|
| `dvrRoot` | DVR storage directory (default: `./dvr_data`) |
| `segmentDuration` | HLS segment length in seconds |
| `liveWindow` | Number of segments in the live playlist |
| `cleanupIntervalMinutes` | How often to run retention cleanup |
| `cameras[].name` | Camera ID used in API routes |
| `cameras[].source` | Input file path or stream URL |
| `cameras[].retentionDays` | How many days of footage to keep |
