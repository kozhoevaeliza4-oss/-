// Хранение фотографий/сканов приказов (ТЗ п.9).
//
// Двухэтапно, потому что регистрация двухэтапная (скан -> подтверждение
// пользователем -> присвоение номера):
// 1. Сразу после загрузки файл кладётся во временную папку под случайным
//    токеном (номер ещё не известен, присваивать его раньше подтверждения
//    нельзя — ТЗ п.3, п.8).
// 2. После подтверждения (когда номер уже присвоен) файл переносится в
//    постоянную структуру `Приказы/<год>/№<номер>-<uuid><ext>`.
//
// Временные файлы, которые никогда не были подтверждены (пользователь
// закрыл вкладку и т.п.), не удаляются немедленно — очищаются по TTL
// (config.orderScanTtlMinutes) при следующем вызове cleanupExpiredTmp.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeExt(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (/^\.[a-z0-9]{1,5}$/.test(ext)) return ext;
  return '.jpg';
}

function saveTmp(buffer, originalName) {
  ensureDir(config.ordersTmpDir);
  const token = uuidv4();
  const filePath = path.join(config.ordersTmpDir, `${token}${safeExt(originalName)}`);
  fs.writeFileSync(filePath, buffer);
  return token;
}

function findTmpFile(token) {
  if (!fs.existsSync(config.ordersTmpDir)) return null;
  const match = fs.readdirSync(config.ordersTmpDir).find((name) => name.startsWith(token));
  return match ? path.join(config.ordersTmpDir, match) : null;
}

function readTmp(token) {
  const filePath = findTmpFile(token);
  if (!filePath) return null;
  return fs.readFileSync(filePath);
}

function deleteTmp(token) {
  const filePath = findTmpFile(token);
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// Переносит подтверждённый скан в постоянное хранилище и возвращает
// путь, который сохраняется в реестре как ссылка на файл (ТЗ п.4, "Файл").
function moveToPermanent(token, { number, date }) {
  const filePath = findTmpFile(token);
  if (!filePath) return null;

  const year = date ? String(date).slice(0, 4) : String(new Date().getFullYear());
  const targetDir = path.join(config.ordersStorageDir, year);
  ensureDir(targetDir);

  const ext = path.extname(filePath);
  const targetName = `№${number}-${uuidv4()}${ext}`;
  const targetPath = path.join(targetDir, targetName);
  fs.renameSync(filePath, targetPath);

  return path.join(year, targetName);
}

function resolveStoredPath(relativeFilePath) {
  return path.join(config.ordersStorageDir, relativeFilePath);
}

// Лучший вариант очистки неподтверждённых сканов — не блокирует запросы,
// вызывается периодически (см. server.js) и по ошибке отдельного файла не
// прерывает остальную очистку.
function cleanupExpiredTmp() {
  if (!fs.existsSync(config.ordersTmpDir)) return;
  const ttlMs = config.orderScanTtlMinutes * 60 * 1000;
  const now = Date.now();
  for (const name of fs.readdirSync(config.ordersTmpDir)) {
    try {
      const filePath = path.join(config.ordersTmpDir, name);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > ttlMs) fs.unlinkSync(filePath);
    } catch {
      // Пропускаем файл, если он уже удалён/недоступен — очистка не критична.
    }
  }
}

module.exports = {
  saveTmp,
  readTmp,
  deleteTmp,
  moveToPermanent,
  resolveStoredPath,
  cleanupExpiredTmp,
};
