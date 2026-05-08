# Howto: Simple-DVR + SRS + nginx для WebRTC/WHEP

## Цель

Поднять на одном сервере рабочую связку:

- `Simple-DVR` пишет архив HLS
- `SRS` отдает live по WebRTC
- `nginx` дает удобный endpoint вида `https://<host>:8443/<camera>/whep`

Итог: один источник камеры, архив в `Simple-DVR` и live WebRTC через `SRS`.

## Итоговая схема

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

## Что нужно заранее

- Ubuntu/Debian сервер
- рабочий `Simple-DVR` из этого репозитория
- `nginx` для HTTPS и проксирования WHEP
- внешнее DNS-имя или публичный IP для `rtc_server.candidate`
- открытый наружу `UDP 8000` для WebRTC media-трафика

## 1. Установка SRS без Docker

Ниже путь, который был успешно пройден на Ubuntu.

### Зависимости

```bash
sudo apt update
sudo apt install -y git build-essential tclsh cmake pkg-config nasm ffmpeg
```

### Сборка

```bash
cd /opt
sudo rm -rf /opt/srs
sudo git clone -b 5.0release https://github.com/ossrs/srs.git /opt/srs
cd /opt/srs/trunk

sudo ./configure --with-rtc --sanitizer=off
sudo make -j"$(nproc)"

ls -l /opt/srs/trunk/objs/srs
```

Если `objs/srs` существует, сборка успешна.

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

Применить:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now srs
sudo systemctl status srs --no-pager -l
```

## 2. Конфиг SRS

Файл: `/opt/srs/trunk/conf/srs.conf`

```conf
# RTMP принимаем только локально (Simple-DVR -> SRS)
listen              127.0.0.1:1935;
max_connections     1000;
daemon              off;

# API только локально (nginx -> SRS)
http_api {
    enabled on;
    listen 127.0.0.1:1985;
}

# В проде встроенный web SRS наружу не нужен
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

Важно:

- замените `candidate demo.example.net;` на реальное публичное DNS-имя или IP сервера
- убедитесь, что `UDP 8000` доступен снаружи, иначе WebRTC negotiation может проходить, а media-трафика не будет
- `1935` и `1985` намеренно слушают только `127.0.0.1`

Применить:

```bash
sudo systemctl restart srs
sudo ss -ltnup | grep -E ':(1935|1985|8000)\b'
curl -sS http://127.0.0.1:1985/api/v1/versions
```

Ожидаемо после запуска:

- `127.0.0.1:1935` для локального RTMP publish
- `127.0.0.1:1985` для локального API
- `0.0.0.0:8000/udp` или интерфейс сервера для WebRTC media

## 3. Настройка Simple-DVR для RTMP publish в SRS

Текущий код в этом репозитории уже поддерживает:

- `source` как основной ключ входного потока
- legacy fallback на `rtsp`
- `rtmpPushUrl`
- `tee` вывод в `HLS + RTMP`
- явный `-map 0:v:0`

### Важные ffmpeg моменты

Для этой схемы критичны:

- `-map 0:v:0`
- `-bsf:v dump_extra`
- `-tag:v 7`
- при необходимости `-max_interleave_delta 0`

Без этого типичная ошибка на FLV/RTMP ветке:

```text
Tag [27][0][0][0] incompatible with output codec id '27' ([7][0][0][0])
```

### Пример рабочего `config.json`

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

Важно:

- не дублируйте `-map 0:v:0` в `ffmpegArgs`, если он уже добавляется кодом
- в этом сценарии `ffmpegArgs` выше не опциональны, а часть рабочего конфига
- запускать `simple-dvr` лучше от `www-data:www-data`, чтобы не получить `root:root` в `/var/dvr`

Перезапуск и проверка:

```bash
sudo systemctl restart simple-dvr
sudo journalctl -u simple-dvr -n 120 --no-pager -o cat | grep -E 'Args:|ffmpeg exited|example-camera'
curl -sS http://127.0.0.1:1985/api/v1/streams/ | grep -E '"name":"example-camera"|"publish"|"video"|"clients"'
```

Ожидаемо:

- `publish.active: true`
- `video` не `null`

## 4. Настройка nginx

### DVR + API на HTTP порту

Если нужен обычный HTTP endpoint для DVR/API, можно использовать отдельный server block:

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

### HTTPS + WHEP endpoint на `8443`

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

Применить:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Проверка маршрута:

```bash
curl -k -i -X OPTIONS https://demo.example.net:8443/example-camera/whep
curl -k -i https://demo.example.net:8443/example-camera/whep
```

Ожидаемо:

- `OPTIONS` -> `204`
- `GET` -> `405`, это нормально

Для реального воспроизведения нужен WebRTC-клиент, который делает `POST` с SDP offer на `/example-camera/whep`.

## 5. Автозапуск и проверка после ребута

```bash
sudo systemctl enable srs simple-dvr
sudo systemctl status srs simple-dvr --no-pager
```

Проверка после ребута:

```bash
curl -sS http://127.0.0.1:1985/api/v1/streams/ | grep -E '"name":"example-camera"|"publish"|"video"'
```

## 6. Что можно почистить в `/opt/srs`

Можно удалить для экономии места:

```bash
sudo rm -rf /opt/srs/.git
sudo rm -rf /opt/srs/trunk/objs/Platform-*
sudo find /opt/srs/trunk/objs -maxdepth 1 -type f -name '*.log' -delete
```

Не удалять:

- `/opt/srs/trunk/objs/srs`
- `/opt/srs/trunk/conf/srs.conf`
- `/opt/srs/trunk/objs/nginx/html`, если используются встроенные статики или тестовые страницы SRS

## 7. Примечание про "WHEP"

Внешний URL `/.../whep` в этой схеме проксируется на SRS `rtc/v1/play` API. Практически это дает удобный WebRTC endpoint для веб-клиентов и кастомных интеграций, но это не строгий RFC WHEP-сервер в чистом виде.
