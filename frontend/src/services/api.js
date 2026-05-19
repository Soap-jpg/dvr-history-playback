/**
 * api.js — Real API layer calling backend on port 4000
 * With client-side caching for video list
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/playback';

const CACHE_KEY = 'okdriver_video_list';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedVideos(imei) {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY}_${imei}`);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(`${CACHE_KEY}_${imei}`);
      return null;
    }
    return data;
  } catch { /* ignore storage errors */ return null; }
}

function setCachedVideos(imei, data) {
  try {
    localStorage.setItem(`${CACHE_KEY}_${imei}`, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* ignore storage errors */ }
}

function clearCache(imei) {
  try {
    localStorage.removeItem(`${CACHE_KEY}_${imei}`);
  } catch { /* ignore storage errors */ }
}

/**
 * Helper for API calls
 */
async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * API 1: Request device to scan TF card (to "wake up" device)
 * POST /api/playback/request-list/{imei}
 */
export async function requestVideoList(imei, useTFCard = true) {
  console.log(`[API] requestVideoList(${imei})`);
  clearCache(imei);
  return apiCall(`/request-list/${imei}`, {
    method: 'POST',
    body: JSON.stringify({ useTFCard })
  });
}

/**
 * API 2: Get available video list
 * GET /api/playback/videos/{imei}
 * Uses client-side caching to avoid redundant API calls
 */
export async function fetchVideoList(imei) {
  console.log(`[API] fetchVideoList(${imei})`);
  
  const cached = getCachedVideos(imei);
  if (cached) {
    // Only use cache if it actually has videos
    const cachedVideos = cached.videos || cached;
    if (Array.isArray(cachedVideos) && cachedVideos.length > 0) {
      console.log(`[API] Returning cached video list for ${imei} (${cachedVideos.length} clips)`);
      return cached;
    }
    // Empty cache — clear it so we fetch fresh
    clearCache(imei);
  }
  
  const result = await apiCall(`/videos/${imei}`);
  
  // Only cache if we got actual videos
  const resultVideos = result.videos || result;
  if (Array.isArray(resultVideos) && resultVideos.length > 0) {
    setCachedVideos(imei, result);
  }
  
  return result;
}

/**
 * API 3: Start video upload/playback
 * POST /api/playback/start/{imei}
 */
export async function playVideo(imei, filename, protocol = 'http', force = true) {
  console.log(`[API] playVideo(${imei}, ${filename})`);
  return apiCall(`/start/${imei}`, {
    method: 'POST',
    body: JSON.stringify({
      videoName: filename,
      protocol,
      force
    })
  });
}

/**
 * API 4: Check upload status (polling)
 * GET /api/playback/status/{imei}/{filename}
 */
export async function checkUploadStatus(imei, filename) {
  return apiCall(`/status/${imei}/${encodeURIComponent(filename)}`);
}