# Simple DVR

A lightweight DVR service built with Node.js + FFmpeg for:

- live HLS streaming from cameras and other video source URLs;
- archive playback by time range;
- MP4 archive export;
- automatic retention cleanup using `retentionDays`.

Repository: `https://github.com/rosteleset/Simple-DVR.git`

## What the service does

- Starts one `ffmpeg` process per camera from `config.json`.
- Stores segments in `/var/dvr/<camera>/YYYY-MM-DD/HH/*.m4s`.
- Optionally mirrors a camera stream to RTMP while keeping DVR recording enabled.
- Serves live and archive playlists over HTTP.
- Generates minute preview clips.
- Runs cleanup in a dedicated worker thread (`cleanup-worker.js`).

## Quick start

1. Copy the config template:

```bash
cp config.example.json config.json
```

2. Update `source` URLs and camera settings in `config.json`.

3. Install dependencies:

```bash
npm init -y
npm install express
```

4. Run:

```bash
sudo -u www-data -g www-data node server.js
```

If you use the default `/var/dvr`, this avoids creating DVR files as `root:root`.

## Main endpoints

- `GET /:camera/live.m3u8` (aliases: `index.m3u8`, `video.m3u8`, `*.fmp4.m3u8`)
- `GET /:camera/dvr.m3u8?start=<ISO>&end=<ISO>`
- `GET /:camera/index-:timestamp-:duration.fmp4.m3u8`
- `GET /:camera/archive-:from-:duration.mp4`
- `GET /:camera/recording_status.json`
- `GET /:camera/:yyyy/:mm/:dd/:HH/:MM/:SS-preview.mp4`
- `GET /dvr/...` direct DVR file access via nginx alias

For full API and deployment details, see [INSTALL.md](./INSTALL.md).

For a complete production setup of `Simple-DVR + SRS + nginx` with WebRTC/WHEP, see [WEBRTC-SRS-HOWTO.md](./WEBRTC-SRS-HOWTO.md).

## Configuration

See [config.example.json](./config.example.json).

Key parameters:

- `dvrRoot`: DVR storage root directory (defaults to `/var/dvr`)
- `segmentDuration`: HLS segment duration (seconds)
- `liveWindow`: live window size (segments)
- `cleanupIntervalMinutes`: cleanup interval
- `cameras[]`: camera list (`name`, `source`, `retentionDays`, `audioArgs`, `ffmpegInputArgs`, `ffmpegArgs`, `rtmpPushUrl`)
- `source`: input URL or path for the camera stream; legacy `rtsp` is still accepted for backward compatibility
- `audioArgs`: per-camera audio args passed to ffmpeg (e.g. `["-an"]` or `["-c:a","aac","-b:a","96k"]`)
- `ffmpegInputArgs`: extra input args inserted before `-i` for this source
- `ffmpegArgs`: extra output args inserted before final playlist path for this camera; for SRS/WebRTC RTMP push, keep the exact args from the install example
- `rtmpPushUrl`: optional RTMP endpoint; when used for SRS/WebRTC, the matching `ffmpegArgs` are required, not optional tuning
- `disableAudio`: legacy fallback; when `audioArgs` is not set: `true` -> `-an`, otherwise audio defaults to `-c:a copy`

For a complete example of publishing a camera to local SRS and exposing it via WebRTC WHEP, see [WEBRTC-SRS-HOWTO.md](./WEBRTC-SRS-HOWTO.md).

## Systemd notes

If you run this as a service, verify:

- `WorkingDirectory` points to the real project directory.
- `ExecStart` points to the real `server.js` path.

## License

Licensed under [LICENSE](./LICENSE).
