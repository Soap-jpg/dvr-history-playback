# Установка Simple DVR

## 1. Требования

- Ubuntu/Debian Linux
- Node.js 20+
- `ffmpeg`
- `nginx`
- `systemd`

Установите необходимые пакеты:

```bash
sudo apt update
sudo apt install -y nodejs npm ffmpeg nginx
```

## 2. Подготовка проекта

```bash
cd /opt
sudo git clone https://github.com/rosteleset/Simple-DVR.git simple-dvr
cd simple-dvr
npm init -y
npm install express
```

## 3. Настройка `config.json`

Скопируйте пример и отредактируйте локальный `config.json`:

```bash
cp config.example.json config.json
```

Пример конфига:

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

Расширенные параметры камеры показаны в `config.example.json`: `source`, `audioArgs`, `ffmpegInputArgs`, `ffmpegArgs` и `rtmpPushUrl` для параллельного RTMP-пуша.

Полный howto по связке `Simple-DVR + SRS + nginx` с WebRTC/WHEP, проверками и типовыми ошибками: [WEBRTC-SRS-HOWTO.ru.md](./WEBRTC-SRS-HOWTO.ru.md).

### Пример: публикация камеры в локальный SRS для WebRTC

Если у вас локально запущен SRS, можно параллельно публиковать поток камеры в `rtmp://127.0.0.1/live/<stream>` и при этом продолжать запись DVR.

В новых конфигах используйте `source`. Legacy `rtsp` все еще поддерживается для обратной совместимости, а не-RTSP источники вроде `https://.../video1.ts` тоже работают.

В этом SRS/WebRTC-примере `ffmpegArgs` обязательны. Не убирайте `-bsf:v dump_extra -tag:v 7 -max_interleave_delta 0`: это часть рабочего пайплайна, а не опциональный тюнинг.

Пример:

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

В этом режиме сервис продолжает писать DVR-сегменты в `/var/dvr/example-cam/...` и одновременно публикует поток в локальный SRS как `live/example-cam`.

## 4. Директория хранения DVR

По умолчанию записи хранятся в `/var/dvr`.

```bash
sudo mkdir -p /var/dvr
sudo chown -R www-data:www-data /var/dvr
sudo chmod -R 755 /var/dvr
```

Если сервис запускается от другого пользователя, замените `www-data` на него.

## 5. Тестовый запуск

Запускайте тестовый старт от того же пользователя и группы, что и сервис. Иначе файлы в `/var/dvr` могут создаться с владельцем `root:root`, и потом запуск через systemd от `www-data:www-data` сломается.

```bash
cd /opt/simple-dvr
sudo -u www-data -g www-data node server.js
```

Проверьте:

- API слушает `127.0.0.1:3000`
- HLS/файлы доступны через nginx на `http://<SERVER_IP>:8080/`

Остановка: `Ctrl+C`.

## 6. Nginx

Скопируйте готовый include-конфиг nginx:

```bash
sudo cp /opt/simple-dvr/nginx_server.include /etc/nginx/sites-available/simple-dvr.conf
sudo ln -sf /etc/nginx/sites-available/simple-dvr.conf /etc/nginx/sites-enabled/simple-dvr.conf
sudo nginx -t
sudo systemctl reload nginx
```

Порты по умолчанию:

- HTTP: `8080`
- HTTPS: `8443` (нужны корректные пути `ssl_certificate` и `ssl_certificate_key`)

### Пример: WHEP endpoint для WebRTC через SRS

Предположения:

- SRS принимает RTMP publish на `rtmp://127.0.0.1/live/<stream>`
- HTTP API SRS слушает `127.0.0.1:1985`
- nginx завершает TLS на `8443`

Можно расширить HTTPS server block так:

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

        # чтобы не было дублирования CORS, например "*, *"
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

Для примера конфига выше WHEP endpoint будет таким:

```text
https://<SERVER_IP>:8443/example-cam/whep
```

После изменения nginx-конфига:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Сервис systemd

Создайте `/etc/systemd/system/simple-dvr.service`:

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

Включение и запуск:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now simple-dvr
sudo systemctl status simple-dvr
```

Логи:

```bash
journalctl -u simple-dvr -f
```

## 8. API-методы Simple DVR

Все эндпоинты ниже отдаются через nginx на порту `8080` (или `8443` для SSL).

### 8.1 Live HLS playlist

`GET` (алиасы одного и того же live-плейлиста):

- `/:camera/live.m3u8`
- `/:camera/index.m3u8`
- `/:camera/video.m3u8`
- `/:camera/live.fmp4.m3u8`
- `/:camera/index.fmp4.m3u8`
- `/:camera/video.fmp4.m3u8`

Пример:

```text
http://<SERVER_IP>:8080/cam1/live.m3u8
```

### 8.2 DVR HLS playlist (архив)

`GET` с query-параметрами:

- `/:camera/dvr.m3u8?start=<ISO_DATE>&end=<ISO_DATE>`

Пример:

```text
http://<SERVER_IP>:8080/cam1/dvr.m3u8?start=2026-02-28T10:00:00Z&end=2026-02-28T10:10:00Z
```

`GET` в формате unix timestamp:

- `/:camera/index-:timestamp-:duration.fmp4.m3u8`
- `/:camera/index-:timestamp-:duration.m3u8`

Где:

- `timestamp` — время начала в Unix-секундах
- `duration` — длительность в секундах

Пример:

```text
http://<SERVER_IP>:8080/cam1/index-1740736800-600.fmp4.m3u8
```

### 8.3 Выгрузка архива в MP4

`GET`:

- `/:camera/archive-:from-:duration.mp4`

Где:

- `from` — время начала в Unix-секундах
- `duration` — длительность в секундах

Пример:

```text
http://<SERVER_IP>:8080/cam1/archive-1740736800-600.mp4
```

### 8.4 Статус диапазонов записи

`GET`:

- `/:camera/recording_status.json`

Пример:

```text
http://<SERVER_IP>:8080/cam1/recording_status.json
```

Ответ содержит доступные диапазоны записи (`from`, `duration`) для камеры.

### 8.5 Preview-ролик по времени

`GET`:

- `/:camera/:yyyy/:mm/:dd/:HH/:MM/:SS-preview.mp4`

Пример:

```text
http://<SERVER_IP>:8080/cam1/2026/02/28/10/15/00-preview.mp4
```

### 8.6 Прямой доступ к DVR-файлам

Nginx отдает `/var/dvr/` под префиксом `/dvr/`:

```text
http://<SERVER_IP>:8080/dvr/<camera>/<YYYY-MM-DD>/<HH>/<segment>.m4s
```

## 9. Проверка после установки

Проверьте:

1. Папки камер создаются в `/var/dvr/<camera_name>/`.
2. Появляется структура `YYYY-MM-DD/HH/*.m4s`.
3. Live-плейлист доступен по `http://<SERVER_IP>:8080/<camera>/live.m3u8`.
4. Cleanup удаляет старые папки часов/дней согласно `retentionDays`.

## 10. Важно про изменения `config.json`

- Cleanup worker подхватывает обновленные `cameras/retentionDays` из `config.json` на следующем цикле очистки.
- Остальная часть приложения (`ffmpeg` startup, интервалы, базовые настройки) читается при старте процесса.
  Чтобы применить эти изменения, перезапустите сервис:

```bash
sudo systemctl restart simple-dvr
```
