/**
 * Model for API 1: POST /api/playback/request-list/{imei}
 */

// Request DTO
class RequestListRequest {
  constructor(data = {}) {
    this.useTFCard = typeof data.useTFCard === 'boolean' ? data.useTFCard : true;
  }
}

// Response DTO
class RequestListResponse {
  constructor(data) {
    this.success = typeof data.success === 'boolean' ? data.success : true;
    this.sessionId = data.sessionId || '';
    this.startTime = data.startTime || '';
    this.endTime = data.endTime || '';
    this.message = data.message || 'FILELIST + TFFILELIST queued...';
    this.listCallback = data.listCallback || '';
    this.uploadEndpoint = data.uploadEndpoint || '';
    this.channelUsed = data.channelUsed || '0';
    this.channelMeaning = data.channelMeaning || 'Both cameras';
    this.daysScanned = typeof data.daysScanned === 'number' ? data.daysScanned : 30;
  }
}

module.exports = {
  RequestListRequest,
  RequestListResponse
};