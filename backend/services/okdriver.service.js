/**
 * okdriver.service.js
 * BFF (Backend-For-Frontend) Proxy Layer
 *
 * Routes requests from our frontend through to the live okDriver hardware APIs.
 * This avoids browser CORS restrictions and adds our Virtual HLS Playlist layer on top.
 *
 * Live API Base URLs:
 *   API 1 (Request List): POST http://smart.okdriver.in:5000/api/playback/request-list/{imei}
 *   API 2 (Video List):   GET  https://smart.okdriver.in/api/playback/videos/{imei}
 *   API 3 (Start Upload): POST http://smart.okdriver.in:5000/api/playback/start/{imei}
 *
 * API 4 (Status / HLS):  GET  localhost:4000/api/playback/status/{imei}/{filename}
 *                         → Our own polling endpoint. Tracks upload state and serves
 *                           a Virtual HLS playlist URL once the device video is ready.
 */

const LIVE_API_1_3 = 'http://smart.okdriver.in:5000/api/playback';
const LIVE_API_2   = 'https://smart.okdriver.in/api/playback';

// ── In-Memory Upload State ─────────────────────────────────────────────────
// Tracks upload lifecycle per device per clip.
// Map<imei, Map<filename, { requestedAt, status, url }>>
const uploadState = new Map();

// ── Helpers ─────────────────────────────────────────────────────────────────

function getOrInitDeviceState(imei) {
  if (!uploadState.has(imei)) uploadState.set(imei, new Map());
  return uploadState.get(imei);
}

function formatYYMMDDHHmmss(date) {
  const y  = String(date.getFullYear()).slice(2);
  const m  = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  const h  = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s  = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${mi}${s}`;
}

/**
 * Extracts HH_MM key from a .ts filename.
 * Format: YYYY_MM_DD_HH_MM_SS_CC.ts
 */
function getHourMinKey(filename) {
  const m = filename.match(/^\d{4}_\d{2}_\d{2}_(\d{2})_(\d{2})_\d{2}_\d{2}\.ts$/);
  return m ? `${m[1]}_${m[2]}` : null;
}

/**
 * Parses filename into video metadata object.
 */
function parseFilename(filename) {
  const match = filename.match(/^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})\.ts$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, cc] = match;
  const channelNum = Number(cc);
  return {
    filename,
    year: Number(year), month: Number(month), day: Number(day),
    hour: Number(hour), minute: Number(minute), second: Number(second),
    channel: channelNum === 3 ? 0 : 1,
    cameraType: channelNum === 3 ? 'ForwardCam' : 'InwardCam',
    videoDate: new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).toISOString(),
    timestamp: new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime(),
  };
}

// ── API 1: Request List ──────────────────────────────────────────────────────
/**
 * Tells the dashcam to scan its TF/SD card and prepare the file list.
 * Routes to the live okDriver API when USE_LIVE_API=true.
 */
async function requestList(imei, options = {}) {
  console.log(`[Service] requestList(${imei})`);

  const url = `${LIVE_API_1_3}/request-list/${imei}`;
  console.log(`[Proxy] POST ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ useTFCard: options.useTFCard ?? true }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`okDriver API 1 error ${res.status}: ${text}`);
  }

  // Pass the live response straight through to our controller DTO
  return res.json();
}

// ── API 2: Get Video List ─────────────────────────────────────────────────────
/**
 * Retrieves the list of .ts filenames available on the dashcam.
 * Routes to the live okDriver API when USE_LIVE_API=true.
 */
async function getVideoList(imei) {
  console.log(`[Service] getVideoList(${imei})`);

  const url = `${LIVE_API_2}/videos/${imei}`;
  console.log(`[Proxy] GET ${url}`);
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`okDriver API 2 error ${res.status}: ${text}`);
  }

  const json = await res.json();
  
  // The live API returns { success: true, data: { videos: [ { filename: '...' } ] } }
  let videoList = [];
  if (Array.isArray(json)) {
    videoList = json;
  } else if (json.data && Array.isArray(json.data.videos)) {
    videoList = json.data.videos;
  } else if (Array.isArray(json.videos)) {
    videoList = json.videos;
  }
  
  // The frontend expects an array of strings (filenames), not objects
  return videoList.map(v => typeof v === 'string' ? v : v.filename).filter(Boolean);
}

// ── API 3: Start Upload ───────────────────────────────────────────────────────
/**
 * Commands the dashcam to start uploading a specific .ts file.
 * Routes to the live okDriver API when USE_LIVE_API=true.
 * Also registers the clip in local uploadState so API 4 can track it.
 */
async function startUpload(imei, videoName, options = {}) {
  console.log(`[Service] startUpload(${imei}, ${videoName})`);

  // Register in-memory upload tracking for API 4 polling
  const deviceState = getOrInitDeviceState(imei);
  if (!deviceState.has(videoName)) {
    deviceState.set(videoName, {
      requestedAt: Date.now(),
      status: 'loading',
      url: null,
    });
    console.log(`[Service] Upload registered: ${videoName}`);
  }

  const parsedInfo = parseFilename(videoName);

  const url = `${LIVE_API_1_3}/start/${imei}`;
  console.log(`[Proxy] POST ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoName,
      protocol: options.protocol ?? 'http',
      force:    options.force    ?? true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`okDriver API 3 error ${res.status}: ${text}`);
  }

  const liveData = await res.json();
  return { ...liveData, videoInfo: parsedInfo };
}

// ── API 4: Check Upload Status (Our Own — HLS Layer) ─────────────────────────
/**
 * Polls whether the video upload is complete and returns the HLS playlist URL.
 * This is our own endpoint — not a live okDriver API.
 *
 * For mock mode: waits 3 seconds, then returns a local virtual .m3u8 URL.
 * For live mode: waits 5 seconds (to allow device to upload), then returns
 *   the Virtual HLS Playlist URL pointing to the live .ts file on the okDriver CDN.
 */
async function getUploadStatus(imei, filename) {
  const deviceState = getOrInitDeviceState(imei);
  const entry = deviceState.get(filename);

  if (!entry) return { status: 'loading' };

  // For live mode: poll the real okDriver /ready/ endpoint
  if (entry.status === 'ready' && entry.url) {
    return { status: 'ready', url: entry.url };
  }

  try {
    const readyUrl = `${LIVE_API_2}/ready/${imei}/${encodeURIComponent(filename)}`;
    console.log(`[Proxy] GET ${readyUrl}`);
    const res = await fetch(readyUrl);

    if (!res.ok) {
      return { status: 'loading' };
    }

    const data = await res.json();

    if (data.ready) {
      // The live API returns mp4Url (browser-native) and videoUrl (raw .ts)
      // Prefer mp4Url since browsers can play it natively without hls.js
      const streamUrl = data.mp4Url || data.videoUrl;
      entry.status = 'ready';
      entry.url = streamUrl;
      console.log(`[Service] LIVE READY: ${filename} -> ${streamUrl}`);
      return { status: 'ready', url: streamUrl };
    }

    return { status: 'loading' };
  } catch (err) {
    console.error(`[Service] Ready check failed for ${filename}:`, err.message);
    return { status: 'loading' };
  }
}

module.exports = {
  getVideoList,
  requestList,
  startUpload,
  getUploadStatus,
};