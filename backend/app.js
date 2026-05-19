/**
 * app.js
 * Express server entry point for okDriver History Playback API
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const playbackRoutes = require('./routes/playback.routes.js');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 4000;

// CORS configuration - allow frontend on ports 5173 and 5174
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

// Parse JSON request bodies
app.use(express.json());

// Mount routes with /api/playback prefix
app.use('/api/playback', playbackRoutes);

app.use('/videos', express.static('public/videos/'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`okDriver Playback API running on http://localhost:${PORT}`);
  console.log(`Mode: 🟢 LIVE → smart.okdriver.in`);
  console.log(`Endpoints:`);
  console.log(`   POST /api/playback/request-list/:imei`);
  console.log(`   GET  /api/playback/videos/:imei`);
  console.log(`   POST /api/playback/start/:imei`);
  console.log(`   GET  /api/playback/status/:imei/:filename`);
  console.log(`   GET  /api/playback/playlist/:tsFilename  (Virtual HLS)`);
});

module.exports = app;