# Simple DVR

Легковесный DVR-сервис на Node.js + FFmpeg для:

- live HLS-стриминга камер и других URL-источников видео;
- просмотра архива по диапазону времени;
- выгрузки архива в MP4;
- автоматической очистки старых записей по `retentionDays`.

Репозиторий: `https://github.com/rosteleset/Simple-DVR.git`

## Что делает сервис

- Запускает по одному `ffmpeg` процессу на каждую камеру из `config.json`.
- Сохраняет сегменты в `/var/dvr/<camera>/YYYY-MM-DD/HH/*.m4s`.
- Опционально зеркалит поток камеры в RTMP, сохраняя DVR-запись.
- Отдает live и archive плейлисты по HTTP.
- Генерирует минутные preview-ролики.
- Запускает очистку в отдельном worker-потоке (`cleanup-worker.js`).

## Быстрый старт

1. Скопируйте шаблон конфига:

```bash
cp config.example.json config.json
```

2. Обновите URL источников в поле `source` и параметры камер в `config.json`.

3. Установите зависимости:

```bash
npm init -y
npm install express
```

4. Запустите:

```bash
sudo -u www-data -g www-data node server.js
```

Если используется стандартный `/var/dvr`, это не даст создать DVR-файлы с владельцем `root:root`.

## Основные эндпоинты

- `GET /:camera/live.m3u8` (алиасы: `index.m3u8`, `video.m3u8`, `*.fmp4.m3u8`)
- `GET /:camera/dvr.m3u8?start=<ISO>&end=<ISO>`
- `GET /:camera/index-:timestamp-:duration.fmp4.m3u8`
- `GET /:camera/archive-:from-:duration.mp4`
- `GET /:camera/recording_status.json`
- `GET /:camera/:yyyy/:mm/:dd/:HH/:MM/:SS-preview.mp4`
- `GET /dvr/...` прямой доступ к DVR-файлам через nginx alias

Полные детали API и развертывания: [INSTALL.ru.md](./INSTALL.ru.md).

Полный howto по связке `Simple-DVR + SRS + nginx` с WebRTC/WHEP: [WEBRTC-SRS-HOWTO.ru.md](./WEBRTC-SRS-HOWTO.ru.md).

## Конфигурация

См. [config.example.json](./config.example.json).

Ключевые параметры:

- `dvrRoot`: корневая директория хранения DVR (по умолчанию `/var/dvr`)
- `segmentDuration`: длительность HLS-сегмента (секунды)
- `liveWindow`: размер live-окна (в сегментах)
- `cleanupIntervalMinutes`: интервал запуска очистки
- `cameras[]`: список камер (`name`, `source`, `retentionDays`, `audioArgs`, `ffmpegInputArgs`, `ffmpegArgs`, `rtmpPushUrl`)
- `source`: входной URL или путь к потоку камеры; legacy `rtsp` все еще поддерживается для обратной совместимости
- `audioArgs`: аргументы аудио на камеру для ffmpeg (например `["-an"]` или `["-c:a","aac","-b:a","96k"]`)
- `ffmpegInputArgs`: доп. входные аргументы для источника, добавляются перед `-i`
- `ffmpegArgs`: доп. выходные аргументы для камеры, добавляются перед итоговым путём плейлиста; для RTMP-пуша в SRS/WebRTC используйте именно набор из install-примера
- `rtmpPushUrl`: необязательный RTMP endpoint; если используется для SRS/WebRTC, соответствующие `ffmpegArgs` обязательны и не являются просто тюнингом
- `disableAudio`: устаревший fallback; если `audioArgs` не задан, то `true` -> `-an`, иначе аудио по умолчанию `-c:a copy`

Полный пример публикации камеры в локальный SRS и выдачи потока через WebRTC WHEP см. в [WEBRTC-SRS-HOWTO.ru.md](./WEBRTC-SRS-HOWTO.ru.md).

## Примечания по systemd

Если запускаете как сервис, проверьте:

- `WorkingDirectory` указывает на реальную директорию проекта.
- `ExecStart` указывает на реальный путь к `server.js`.

## Лицензия

Лицензия: [LICENSE](./LICENSE).
