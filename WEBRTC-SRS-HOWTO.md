# Howto: Simple-DVR + SRS + nginx for WebRTC/WHEP

## Goal

Run a working single-server setup with:

- `Simple-DVR` writing HLS archive
- `SRS` serving live over WebRTC
- `nginx` exposing a convenient endpoint such as `https://<host>:8443/<camera>/whep`

Result: one camera source, HLS archive in `Simple-DVR`, live WebRTC via `SRS`.

## Final topology

```text
Camera source
   -> Simple-DVR (ffmpeg)
      -> HLS archive (/var/dvr/<camera>/...)
      -> RTMP publish -> SRS (rtmp://127.0.0.1/live/<camera>)
SRS
   -> WebRTC play (rtc/v1/play)
nginx
   -> proxy /<camera>/whep -> SRS rtc/v1/play
```

## Prerequisites

- Ubuntu/Debian server
- working `Simple-DVR` from this repository
- `nginx` for HTTPS and WHEP proxying
- public DNS name or public IP for `rtc_server.candidate`
- `UDP 8000` reachable from clients for WebRTC media

## 1. Install SRS without Docker

The flow below was successfully used on Ubuntu.

### Dependencies

```bash
sudo apt update
sudo apt install -y git build-essential tclsh cmake pkg-config nasm ffmpeg
```

### Build

```bash
cd /opt
sudo rm -rf /opt/srs
sudo git clone -b 5.0release https://github.com/ossrs/srs.git /opt/srs
cd /opt/srs/trunk

sudo ./configure --with-rtc --sanitizer=off
sudo make -j"$(nproc)"

ls -l /opt/srs/trunk/objs/srs
```

If `objs/srs` exists, the build succeeded.

### systemd unit `/etc/systemd/system/srs.service`

```ini
[Unit]
Description=SRS Media Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/srs/trunk
ExecStart=/opt/srs/trunk/objs/srs -c /opt/srs/trunk/conf/srs.conf
Restart=always
RestartSec=2
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Apply:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now srs
sudo systemctl status srs --no-pager -l
```

## 2. Configure SRS

File: `/opt/srs/trunk/conf/srs.conf`

```conf
# Accept RTMP only locally (Simple-DVR -> SRS)
listen              127.0.0.1:1935;
max_connections     1000;
daemon              off;

# API only locally (nginx -> SRS)
http_api {
    enabled on;
    listen 127.0.0.1:1985;
}

# Built-in SRS web server is not needed externally in production
http_server {
    enabled off;
}

rtc_server {
    enabled on;
    listen 8000;
    candidate demo.example.net;
}

vhost __defaultVhost__ {
    rtc {
        enabled on;
        rtmp_to_rtc on;
        rtc_to_rtmp off;
    }
}
```

Important:

- replace `candidate demo.example.net;` with the real public DNS name or IP of the server
- make sure `UDP 8000` is reachable from outside, otherwise WebRTC may negotiate but media will fail
- `1935` and `1985` are intentionally bound to `127.0.0.1`

Apply:

```bash
sudo systemctl restart srs
sudo ss -ltnup | grep -E ':(1935|1985|8000)\b'
curl -sS http://127.0.0.1:1985/api/v1/versions
```

Expected listeners:

- `127.0.0.1:1935` for local RTMP publish
- `127.0.0.1:1985` for local API
- `0.0.0.0:8000/udp` or the server interface for WebRTC media

## 3. Configure Simple-DVR to publish RTMP into SRS

The current code in this repository already supports:

- `source` as the primary input field
- legacy fallback to `rtsp`
- `rtmpPushUrl`
- `tee` output for `HLS + RTMP`
- explicit `-map 0:v:0`

### Important ffmpeg details

This pipeline depends on:

- `-map 0:v:0`
- `-bsf:v dump_extra`
- `-tag:v 7`
- `-max_interleave_delta 0` when needed

Without that, a typical FLV/RTMP branch error is:

```text
Tag [27][0][0][0] incompatible with output codec id '27' ([7][0][0][0])
```

### Example working `config.json`

```json
{
  "dvrRoot": "/var/dvr",
  "segmentDuration": 4,
  "liveWindow": 6,
  "cleanupIntervalMinutes": 5,
  "cameras": [
    {
      "name": "example-camera",
      "source": "https://streams.example.test/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/video1.ts",
      "retentionDays": 1,
      "audioArgs": ["-an"],
      "rtmpPushUrl": "rtmp://127.0.0.1/live/example-camera",
      "ffmpegArgs": ["-bsf:v", "dump_extra", "-tag:v", "7", "-max_interleave_delta", "0"]
    }
  ]
}
```

Important:

- do not duplicate `-map 0:v:0` inside `ffmpegArgs` if the code already adds it
- in this SRS/WebRTC setup the `ffmpegArgs` above are part of the working config, not optional tuning
- prefer running `simple-dvr` as `www-data:www-data` to avoid `root:root` files inside `/var/dvr`

Restart and verify:

```bash
sudo systemctl restart simple-dvr
sudo journalctl -u simple-dvr -n 120 --no-pager -o cat | grep -E 'Args:|ffmpeg exited|example-camera'
curl -sS http://127.0.0.1:1985/api/v1/streams/ | grep -E '"name":"example-camera"|"publish"|"video"|"clients"'
```

Expected:

- `publish.active: true`
- `video` is not `null`

## 4. Configure nginx

### DVR + API on plain HTTP

If you want a plain HTTP endpoint for DVR/API, use a separate server block:

```nginx
server {
    listen 5080 default_server;

    location /dvr/ {
        alias /var/dvr/;
        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp4 mp4 m4s;
        }
        access_log off;
        add_header Cache-Control no-cache;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control no-cache;
    }
}
```

### HTTPS + WHEP endpoint on `8443`

```nginx
server {
    listen 8443 ssl http2 default_server;

    ssl_certificate     /etc/ssl/cert.pem;
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

Apply:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Route checks:

```bash
curl -k -i -X OPTIONS https://demo.example.net:8443/example-camera/whep
curl -k -i https://demo.example.net:8443/example-camera/whep
```

Expected:

- `OPTIONS` -> `204`
- `GET` -> `405`, which is normal

Actual playback requires a WebRTC client that sends a `POST` SDP offer to `/example-camera/whep`.

## 5. Autostart and reboot checks

```bash
sudo systemctl enable srs simple-dvr
sudo systemctl status srs simple-dvr --no-pager
```

After reboot:

```bash
curl -sS http://127.0.0.1:1985/api/v1/streams/ | grep -E '"name":"example-camera"|"publish"|"video"'
```

## 6. What can be cleaned under `/opt/srs`

Safe to remove to save disk space:

```bash
sudo rm -rf /opt/srs/.git
sudo rm -rf /opt/srs/trunk/objs/Platform-*
sudo find /opt/srs/trunk/objs -maxdepth 1 -type f -name '*.log' -delete
```

Do not remove:

- `/opt/srs/trunk/objs/srs`
- `/opt/srs/trunk/conf/srs.conf`
- `/opt/srs/trunk/objs/nginx/html` if you use SRS built-in static/test pages

## 7. Note about "WHEP"

In this setup the external `/.../whep` URL proxies into the SRS `rtc/v1/play` API. In practice that gives a convenient WebRTC endpoint for web clients and custom integrations, but it is not a strict RFC WHEP server in the pure sense.
