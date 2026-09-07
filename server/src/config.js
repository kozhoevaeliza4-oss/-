const path = require('path');
const fs = require('fs');

// Простая загрузка .env без внешней зависимости: переменные окружения,
// уже заданные снаружи (docker, systemd, CI), имеют приоритет.
(function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
})();

module.exports = {
  port: Number(process.env.PORT) || 3000,
  apiAuthToken: process.env.API_AUTH_TOKEN || '',
  ocrProvider: process.env.OCR_PROVIDER || 'mock',
  yandexVisionApiKey: process.env.YANDEX_VISION_API_KEY || '',
  yandexVisionFolderId: process.env.YANDEX_VISION_FOLDER_ID || '',
  ocrConfidenceThreshold: Number(process.env.OCR_CONFIDENCE_THRESHOLD) || 0.8,
  idPhotoRetentionHours: Number(process.env.ID_PHOTO_RETENTION_HOURS) || 24,
  dataFile: path.join(__dirname, 'data', 'deals.json'),
};
