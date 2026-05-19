/**
 * Model for API 3: POST /api/playback/start/{imei}
 */

// Request DTO
class StartPlaybackRequest {
  constructor(data = {}) {
    this.videoName = data.videoName || '';
    this.protocol = data.protocol || 'http';
    this.force = typeof data.force === 'boolean' ? data.force : true;
  }

  validate() {
    const errors = [];
    if (!this.videoName) errors.push('videoName is required');
    if (!this.protocol) errors.push('protocol is required');
    if (typeof this.force !== 'boolean') errors.push('force must be a boolean');
    return errors;
  }
}

// Response DTO
class StartPlaybackResponse {
  static SUCCESS_MESSAGE = 'UPLOAD + HVIDEO sent. Device will upload via HTTP POST';

  constructor(videoName, parsedVideoInfo) {
    this.success = true;
    this.message = StartPlaybackResponse.SUCCESS_MESSAGE;
    this.videoName = videoName;
    this.videoInfo = {
      filename: parsedVideoInfo.filename || videoName,
      year: parsedVideoInfo.year || null,
      month: parsedVideoInfo.month || null,
      day: parsedVideoInfo.day || null,
      hour: parsedVideoInfo.hour || null,
      minute: parsedVideoInfo.minute || null,
      second: parsedVideoInfo.second || null,
      channel: parsedVideoInfo.channel || null,
      cameraType: parsedVideoInfo.cameraType || '',
      videoDate: parsedVideoInfo.videoDate || '',
      timestamp: parsedVideoInfo.timestamp || null
    };
  }
}

module.exports = {
  StartPlaybackRequest,
  StartPlaybackResponse
};