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
  ocrProvider: process.env.OCR_PROVIDER || 'mock',
  yandexVisionApiKey: process.env.YANDEX_VISION_API_KEY || '',
  yandexVisionFolderId: process.env.YANDEX_VISION_FOLDER_ID || '',
  ocrConfidenceThreshold: Number(process.env.OCR_CONFIDENCE_THRESHOLD) || 0.8,
  idPhotoRetentionHours: Number(process.env.ID_PHOTO_RETENTION_HOURS) || 24,

  // --- Учётные записи компаний и вход (одна учётка = одна компания,
  // данные компаний изолированы друг от друга, см. README) ---
  companiesFile: path.join(__dirname, 'data', 'companies.json'),
  sessionCookieName: 'nz_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS) || 12,

  // Данные каждой компании лежат в собственном файле/подпапке внутри этих
  // директорий, поименованном по id компании — это и есть изоляция данных
  // между компаниями (см. README, "Мультиарендность").
  dealsDataDir: path.join(__dirname, 'data', 'deals'),

  // --- Реестр приказов (ТЗ "Автоматизированная система регистрации и
  // нумерации приказов") ---
  ordersDataDir: path.join(__dirname, 'data', 'orders'),
  ordersStorageBaseDir: path.join(__dirname, 'data', 'orders-files'),
  ordersTmpBaseDir: path.join(__dirname, 'data', 'orders-tmp'),
  // Порог похожести (0..1) для предупреждения о возможном дубликате (п.7 ТЗ).
  orderDuplicateThreshold: Number(process.env.ORDER_DUPLICATE_THRESHOLD) || 0.7,
  // Сколько минут неподтверждённое фото/скан ждёт подтверждения (POST
  // /confirm или /bulk-confirm), прежде чем временный файл можно удалить.
  orderScanTtlMinutes: Number(process.env.ORDER_SCAN_TTL_MINUTES) || 60,
};
