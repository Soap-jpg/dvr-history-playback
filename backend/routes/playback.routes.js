/**
 * playback.routes.js
 * Express Router - wire controller methods to endpoints
 */
const express = require('express');
const router = express.Router();
const controller = require('../controllers/playback.controller.js');

// POST /api/playback/request-list/:imei
router.post('/request-list/:imei', controller.requestList);

// GET /api/playback/videos/:imei
router.get('/videos/:imei', controller.getVideos);

// POST /api/playback/start/:imei
router.post('/start/:imei', controller.startPlayback);

// GET /api/playback/status/:imei/:filename
router.get('/status/:imei/:filename', controller.checkStatus);

// GET /api/playback/playlist/:tsFilename  (HLS virtual playlist)
router.get('/playlist/:tsFilename', controller.getPlaylist);

module.exports = router;