# okDriver DVR — History Playback Module

A production-ready, continuous DVR playback dashboard for the okDriver platform. Features an interactive 24-hour timeline, seamless double-buffered auto-play, synchronized dual-camera viewing, and full integration with the live okDriver hardware APIs.

---

## Features Implemented

As per the assignment requirements, the following core features have been implemented:

1. **Clickable History Timeline:** The 24-hour timeline bar is fully interactive. Clicking any point immediately identifies the covering video clip, calls API 3, and seeks to the exact requested offset. A visual scrubber moves in real-time.
2. **Continuous Auto-Play:** A seamless DVR-style continuous playback experience. As one clip nears completion, the system actively pre-fetches the next chronological clip. When the current clip ends, it automatically transitions to the next clip with minimal buffering.
3. **Dual Camera Sync:** Forward (Channel 03) and Inward (Channel 04) cameras play side-by-side in sync when both are available. The system intelligently handles timestamp drift between the two hardware sensors.
4. **Playback State Management:** Robust handling of the dashcam's asynchronous upload process. The UI displays clear loading states while polling API 4, waiting for clips to be uploaded from the vehicle's TF card over 4G.

---

## Setup & How to Run

This is a Monorepo-style project with a `backend/` and `frontend/` directory. Both must run simultaneously.

### Prerequisites
- Node.js v18 or higher
- npm

### 1. Start the Backend

```bash
cd backend
npm install
npm run dev
```

The backend will start on `http://localhost:4000`.


### 2. Start the Frontend

Open a **new terminal window**:

```bash
cd frontend
npm install
npm run dev
```

The frontend will start on `http://localhost:5173`. Open this URL in your browser.

---


## Device Configuration

The three test device IMEIs are pre-configured in the vehicle dropdown:

| Device | IMEI |
|---|---|
| Device 1 | 503079604270 |
| Device 2 | 860503079604270 |
| Device 3 | 864993060968006 |

To add or change devices, edit the `DEMO_VEHICLES` array in `frontend/src/components/HistoryDashboard.jsx`.

---


## Approach & Architecture

### Overview

The system is built as a **BFF (Backend-For-Frontend) Proxy** architecture:

```
Browser (React)
    ↓  always talks to
Node.js Backend (localhost:4000)
    ↓  proxies to (when USE_LIVE_API=true)
okDriver Hardware API (smart.okdriver.in)
    ↓  commands the physical dashcam to upload
Raw Video File → Browser plays native HTML5 video directly
```

### Why a Node.js Backend Is Required

Two browser-level restrictions make a backend proxy mandatory:

1. **CORS:** The browser blocks cross-origin API calls to `smart.okdriver.in` unless that server explicitly allows it. A Node.js server has no such restriction and can proxy freely.
2. **Mixed Content:** API 1 and API 3 use plain `http://` on port 5000. Modern browsers block `http://` requests made from an `https://` page. Node.js is not subject to this rule.

### Frontend: Double-Buffered Sliding Window Queue

Instead of a standard Array-based clip queue, we implemented a **Double-Buffered Sliding Window**:

- Two permanent `<video>` tags exist in the DOM: **Slot A** and **Slot B**.
- While Slot A plays the current clip, Slot B silently pre-loads the next clip in the background.
- When Slot A fires `onEnded`, the player instantly crossfades to Slot B — **zero loading gap between clips**.
- The state machine uses explicit `currentClipPair` and `nextClipPair` React state variables ensuring fresh values on every render.

### Frontend: Continuous Timeline & Pre-fetching

To achieve seamless, continuous playback, the `usePlaybackManager` hook implements an intelligent pre-fetch mechanism. 
Once a clip starts playing, a background process immediately begins polling API 4 for the next chronological clip in the queue. By the time the user reaches the end of the current clip, the next clip's URL is fully resolved and ready to stream.

Furthermore, clicking anywhere on the timeline calculates the exact offset needed, seeks the HTML5 player instantly if within the current clip, or cleanly transitions to a new clip without restarting the application state.


## Backend Changes Made

The following changes were made to the provided Node.js backend skeleton:

| Change | File | Description |
|---|---|---|
| **BFF Proxy Layer** | `services/okdriver.service.js` | Completely rewrote the mock service into a live proxy. All 3 API calls route to `smart.okdriver.in` using native `fetch()`. |
| **Clip Pre-fetching** | `services/okdriver.service.js` | When API 3 is called for the current clip, the backend also fires a background promise to begin the next clip's upload immediately, minimizing inter-clip gaps. |
| **Stateful Upload Tracking** | `services/okdriver.service.js` | Added an in-memory `uploadState` Map to track upload lifecycle per device per clip, enabling the frontend polling mechanism (API 4). |
| **DTO Architecture** | `models/*.model.js` | Implemented Data Transfer Object classes for all 4 API responses to enforce strict schema validation and decouple the hardware API contract from internal logic. |
| **dotenv Support** | `app.js` | Added `dotenv` for environment variable management. Startup log lists all registered endpoints. |

---

## Live okDriver API Endpoints

| # | Method | URL | Purpose |
|---|---|---|---|
| API 1 | `POST` | `http://smart.okdriver.in:5000/api/playback/request-list/{imei}` | Wake dashcam, trigger SD card scan |
| API 2 | `GET` | `https://smart.okdriver.in/api/playback/videos/{imei}` | Fetch list of recorded `.ts` filenames |
| API 3 | `POST` | `http://smart.okdriver.in:5000/api/playback/start/{imei}` | Command device to upload a specific clip |
| API 4 | `GET` | `http://localhost:4000/api/playback/status/{imei}/{filename}` | Our own polling endpoint — tracks upload readiness and returns Virtual HLS playlist URL |
