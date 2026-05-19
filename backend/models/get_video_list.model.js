/**
 * Model for API 2: GET /api/playback/videos/{imei}
 * Response DTO
 */
class VideoListResponse {
  constructor(imei, videosArray) {
    this.success = true;
    this.imei = imei;
    this.videos = Array.isArray(videosArray) ? videosArray : [];
  }
}

module.exports = {
  VideoListResponse
};