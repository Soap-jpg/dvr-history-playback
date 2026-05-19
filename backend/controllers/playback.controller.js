/**
 * playback.controller.js
 * HTTP request handlers with DTO transformation
 */
const { RequestListResponse } = require('../models/post_metadata.model.js');
const { VideoListResponse } = require('../models/get_video_list.model.js');
const { StartPlaybackResponse } = require('../models/post_playback.model.js');
const okdriverService = require('../services/okdriver.service.js');

/**
 * API 1: POST /request-list/:imei
 * Trigger device to scan TF card for video inventory
 */
async function requestList(req, res) {
  try {
    const { imei } = req.params;
    const { useTFCard } = req.body || {};

    const rawData = await okdriverService.requestList(imei, { useTFCard });
    const dto = new RequestListResponse(rawData);

    res.json(dto);
  } catch (error) {
    console.error('[Controller] requestList error:', error);
    res.status(500).json({ error: 'Failed to request video list' });
  }
}

/**
 * API 2: GET /videos/:imei
 * Get available video list from device
 */
async function getVideos(req, res) {
  try {
    const { imei } = req.params;

    const videosArray = await okdriverService.getVideoList(imei);
    const dto = new VideoListResponse(imei, videosArray);

    res.json(dto);
  } catch (error) {
    console.error('[Controller] getVideos error:', error);
    res.status(500).json({ error: 'Failed to get video list' });
  }
}

/**
 * API 3: POST /start/:imei
 * Start video upload/playback
 * 
 * CRITICAL: Pre-fetch logic for Clip Queue pattern
 * - Parse currentClip and nextClip from req.body
 * - Await service call for currentClip
 * - Fire-and-forget for nextClip (background promise)
 */
async function startPlayback(req, res) {
  try {
    const { imei } = req.params;
    const { videoName, protocol, force, currentClip, nextClip } = req.body;

    if (!videoName) {
      return res.status(400).json({ error: 'videoName is required' });
    }

    // await current clip upload request
    const rawData = await okdriverService.startUpload(imei, videoName);
    const dto = new StartPlaybackResponse(videoName, rawData.videoInfo);

    // pre-fetch next clip (Clip Queue pattern)
    if (nextClip && nextClip.filename) {
      okdriverService.startUpload(imei, nextClip.filename)
        .then(() => console.log(`[Controller] Pre-fetched next clip: ${nextClip.filename}`))
        .catch(err => console.error('[Controller] Pre-fetch error:', err));
    }

    res.json(dto);
  } catch (error) {
    console.error('[Controller] startPlayback error:', error);
    res.status(500).json({ error: 'Failed to start playback' });
  }
}

/**
 * API 4 (Custom): GET /status/:imei/:filename
 * Poll upload status - called repeatedly by frontend until ready
 */
async function checkStatus(req, res) {
  try {
    const { imei, filename } = req.params;

    const result = await okdriverService.getUploadStatus(imei, filename);

    res.json(result);
  } catch (error) {
    console.error('[Controller] checkStatus error:', error);
    res.status(500).json({ error: 'Failed to check upload status' });
  }
}

/**
 * API 5 (HLS): GET /playlist/:tsFilename
 * Dynamically generates a single-segment .m3u8 playlist pointing to a raw .ts file.
 * This allows hls.js on the frontend to consume raw .ts clips without ffmpeg or real HLS segmentation.
 */
function getPlaylist(req, res) {
  try {
    const { tsFilename } = req.params;

    if (!tsFilename || !tsFilename.endsWith('.ts')) {
      return res.status(400).json({ error: 'Invalid .ts filename' });
    }

    // Build the absolute URL to the static .ts file
    const tsUrl = `${req.protocol}://${req.get('host')}/videos/${tsFilename}`;

    // Generate a valid HLS VOD playlist with a single segment
    const m3u8 = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:300',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXTINF:300.000,',
      tsUrl,
      '#EXT-X-ENDLIST',
    ].join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(m3u8);
  } catch (error) {
    console.error('[Controller] getPlaylist error:', error);
    res.status(500).json({ error: 'Failed to generate playlist' });
  }
}

module.exports = {
  requestList,
  getVideos,
  startPlayback,
  checkStatus,
  getPlaylist
};