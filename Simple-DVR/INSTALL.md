# Simple DVR Installation

## 1. Requirements

- Ubuntu/Debian Linux
- Node.js 20+
- `ffmpeg`
- `nginx`
- `systemd`

Install required packages:

```bash
sudo apt update
sudo apt install -y nodejs npm ffmpeg nginx
```

## 2. Project setup

```bash
cd /opt
sudo git clone https://github.com/rosteleset/Simple-DVR.git simple-dvr
cd simple-dvr
npm init -y
npm install express
```

## 3. Configure `config.json`

Copy the example and edit your local `config.json`:

```bash
cp config.example.json config.json
```

Example config:

```json
{
  "dvrRoot": "/var/dvr",
  "segmentDuration": 4,
  "liveWindow": 6,
  "cleanupIntervalMinutes": 5,
  "cameras": [
    {
      "name": "cam1",
      "source": "rtsp://login:password@camera-host/stream",
      "retentionDays": 1
    }
  ]
}
```

Advanced per-camera options are shown in `config.example.json`: `source`, `audioArgs`, `ffmpegInputArgs`, `ffmpegArgs`, and `rtmpPushUrl` for parallel RTMP push.

For a full end-to-end setup of `Simple-DVR + SRS + nginx` with WebRTC/WHEP, validation and troubleshooting, see [WEBRTC-SRS-HOWTO.md](./WEBRTC-SRS-HOWTO.md).

### Example: publish a camera to local SRS for WebRTC

If you run SRS locally, you can push the same camera stream to `rtmp://127.0.0.1/live/<stream>` and keep DVR recording enabled at the same time.

Use `source` in new configs. Legacy `rtsp` is still accepted for backward compatibility, and non-RTSP inputs such as `https://.../video1.ts` are supported too.

In this SRS/WebRTC example, `ffmpegArgs` are required. Do not remove `-bsf:v dump_extra -tag:v 7 -max_interleave_delta 0`: they are part of the working pipeline, not optional tuning.

Example:

```json
{
  "dvrRoot": "/var/dvr",
  "segmentDuration": 4,
  "liveWindow": 6,
  "cleanupIntervalMinutes": 5,
  "cameras": [
    {
      "name": "example-cam",
      "source": "https://camera-source.invalid/example-cam/video1.ts",
      "rtmpPushUrl": "rtmp://127.0.0.1/live/example-cam",
      "ffmpegArgs": ["-bsf:v", "dump_extra", "-tag:v", "7", "-max_interleave_delta", "0"],
      "retentionDays": 1,
      "audioArgs": ["-an"]
    }
  ]
}
```

This keeps writing DVR segments into `/var/dvr/example-cam/...` and also publishes the stream to local SRS as `live/example-cam`.

## 4. DVR storage directory

By default, the service stores recordings in `/var/dvr`.

```bash
sudo mkdir -p /var/dvr
sudo chown -R www-data:www-data /var/dvr
sudo chmod -R 755 /var/dvr
```

If you run the service as another user, replace `www-data` accordingly.

## 5. Test run

Run the test start under the same user/group as the service. Otherwise, files in `/var/dvr` may be created as `root:root`, and the later systemd start under `www-data:www-data` may fail.

```bash
cd /opt/simple-dvr
sudo -u www-data -g www-data node server.js
```

Check:

- API listens on `127.0.0.1:3000`
- HLS/files are available via nginx at `http://<SERVER_IP>:8080/`

Stop with `Ctrl+C`.

## 6. Nginx

Copy the provided nginx config include:

```bash
sudo cp /opt/simple-dvr/nginx_server.include /etc/nginx/sites-available/simple-dvr.conf
sudo ln -sf /etc/nginx/sites-available/simple-dvr.conf /etc/nginx/sites-enabled/simple-dvr.conf
sudo nginx -t
sudo systemctl reload nginx
```

Default ports in this project:

- HTTP: `8080`
- HTTPS: `8443` (requires valid `ssl_certificate` and `ssl_certificate_key` paths)

### Example: expose a WebRTC WHEP endpoint for SRS

Assumptions:

- SRS accepts RTMP publish on `rtmp://127.0.0.1/live/<stream>`
- SRS HTTP API listens on `127.0.0.1:1985`
- nginx terminates TLS on `8443`

You can extend the HTTPS server block like this:

```nginx
server {

    listen 8443 ssl http2 default_server;

    ssl_certificate /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;

    client_max_body_size 100M;

    location /dvr/ {
        alias /var/dvr/;

        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp4 mp4 m4s;
        }
        access_log off;
        add_header Cache-Control no-cache;
    }

    location ~ ^/(?<cam>[A-Za-z0-9_-]+)/whep$ {
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin "*" always;
            add_header Access-Control-Allow-Methods "POST, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
            add_header Content-Length 0;
            add_header Content-Type text/plain;
            return 204;
        }

        if ($request_method != POST) { return 405; }

        rewrite ^/(?<cam>[A-Za-z0-9_-]+)/whep$ /rtc/v1/play/?app=live&stream=$cam break;
        proxy_pass http://127.0.0.1:1985;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;

        # avoid duplicate CORS values such as "*, *"
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;

        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control no-cache;
    }
}
```

For the config example above, the WHEP endpoint becomes:

```text
https://<SERVER_IP>:8443/example-cam/whep
```

After editing nginx config:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Systemd service

Create `/etc/systemd/system/simple-dvr.service`:

```ini
[Unit]
Description=Simple DVR Service
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/simple-dvr
ExecStart=/usr/bin/node /opt/simple-dvr/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Start and enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now simple-dvr
sudo systemctl status simple-dvr
```

Logs:

```bash
journalctl -u simple-dvr -f
```

## 8. Simple DVR API methods

All endpoints below are served through nginx on port `8080` (or `8443` for SSL).

### 8.1 Live HLS playlist

`GET` (aliases for the same live playlist):

- `/:camera/live.m3u8`
- `/:camera/index.m3u8`
- `/:camera/video.m3u8`
- `/:camera/live.fmp4.m3u8`
- `/:camera/index.fmp4.m3u8`
- `/:camera/video.fmp4.m3u8`

Example:

```text
http://<SERVER_IP>:8080/cam1/live.m3u8
```

### 8.2 DVR HLS playlist (archive)

`GET` with query parameters:

- `/:camera/dvr.m3u8?start=<ISO_DATE>&end=<ISO_DATE>`

Example:

```text
http://<SERVER_IP>:8080/cam1/dvr.m3u8?start=2026-02-28T10:00:00Z&end=2026-02-28T10:10:00Z
```

`GET` with unix timestamp format:

- `/:camera/index-:timestamp-:duration.fmp4.m3u8`
- `/:camera/index-:timestamp-:duration.m3u8`

Where:

- `timestamp` is start time in Unix seconds
- `duration` is duration in seconds

Example:

```text
http://<SERVER_IP>:8080/cam1/index-1740736800-600.fmp4.m3u8
```

### 8.3 MP4 archive export

`GET`:

- `/:camera/archive-:from-:duration.mp4`

Where:

- `from` is start time in Unix seconds
- `duration` is duration in seconds

Example:

```text
http://<SERVER_IP>:8080/cam1/archive-1740736800-600.mp4
```

### 8.4 Recording ranges status

`GET`:

- `/:camera/recording_status.json`

Example:

```text
http://<SERVER_IP>:8080/cam1/recording_status.json
```

Response contains available recording ranges (`from`, `duration`) for the camera.

### 8.5 Time-based preview clip

`GET`:

- `/:camera/:yyyy/:mm/:dd/:HH/:MM/:SS-preview.mp4`

Example:

```text
http://<SERVER_IP>:8080/cam1/2026/02/28/10/15/00-preview.mp4
```

### 8.6 Direct DVR file access

Nginx serves `/var/dvr/` under `/dvr/`:

```text
http://<SERVER_IP>:8080/dvr/<camera>/<YYYY-MM-DD>/<HH>/<segment>.m4s
```

## 9. Post-install checks

Verify:

1. Camera folders are created in `/var/dvr/<camera_name>/`.
2. The structure `YYYY-MM-DD/HH/*.m4s` appears.
3. Live playlist is available at `http://<SERVER_IP>:8080/<camera>/live.m3u8`.
4. Cleanup removes old hour/day folders according to `retentionDays`.

## 10. Important note about `config.json` changes

- Cleanup worker reads updated `cameras/retentionDays` from `config.json` on the next cleanup cycle.
- The rest of the app (`ffmpeg` startup, intervals, base settings) is read at process start.
  Restart the service to apply those changes:

```bash
sudo systemctl restart simple-dvr
```
