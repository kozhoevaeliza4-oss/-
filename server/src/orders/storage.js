// Хранение фотографий/сканов приказов (ТЗ п.9).
//
// Двухэтапно, потому что регистрация двухэтапная (скан -> подтверждение
// пользователем -> присвоение номера):
// 1. Сразу после загрузки файл кладётся во временную папку компании под
//    случайным токеном (номер ещё не известен, присваивать его раньше
//    подтверждения нельзя — ТЗ п.3, п.8).
// 2. После подтверждения (когда номер уже присвоен) файл переносится в
//    постоянную структуру `<companyId>/<год>/№<номер>-<uuid><ext>`.
//
// Всё разложено по подпапке компании (companyId) — это часть изоляции
// данных между компаниями наравне с отдельным файлом реестра (см.
// registry.js, README "Мультиарендность"): у компании физически нет
// доступа к чужим файлам, даже если бы кто-то узнал прямой путь.
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

function tmpDirFor(companyId) {
  return path.join(config.ordersTmpBaseDir, companyId);
}

function storageDirFor(companyId) {
  return path.join(config.ordersStorageBaseDir, companyId);
}

function saveTmp(companyId, buffer, originalName) {
  const dir = tmpDirFor(companyId);
  ensureDir(dir);
  const token = uuidv4();
  const filePath = path.join(dir, `${token}${safeExt(originalName)}`);
  fs.writeFileSync(filePath, buffer);
  return token;
}

function findTmpFile(companyId, token) {
  const dir = tmpDirFor(companyId);
  if (!fs.existsSync(dir)) return null;
  const match = fs.readdirSync(dir).find((name) => name.startsWith(token));
  return match ? path.join(dir, match) : null;
}

function readTmp(companyId, token) {
  const filePath = findTmpFile(companyId, token);
  if (!filePath) return null;
  return fs.readFileSync(filePath);
}

function deleteTmp(companyId, token) {
  const filePath = findTmpFile(companyId, token);
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// Переносит подтверждённый скан в постоянное хранилище компании и
// возвращает путь (относительно папки компании), который сохраняется в
// реестре как ссылка на файл (ТЗ п.4, "Файл").
function moveToPermanent(companyId, token, { number, date }) {
  const filePath = findTmpFile(companyId, token);
  if (!filePath) return null;

  const year = date ? String(date).slice(0, 4) : String(new Date().getFullYear());
  const targetDir = path.join(storageDirFor(companyId), year);
  ensureDir(targetDir);

  const ext = path.extname(filePath);
  const targetName = `№${number}-${uuidv4()}${ext}`;
  const targetPath = path.join(targetDir, targetName);
  fs.renameSync(filePath, targetPath);

  return path.join(year, targetName);
}

function resolveStoredPath(companyId, relativeFilePath) {
  return path.join(storageDirFor(companyId), relativeFilePath);
}

// Лучший вариант очистки неподтверждённых сканов — не блокирует запросы,
// вызывается периодически (см. server.js) и по ошибке отдельного файла не
// прерывает остальную очистку. Проходит по всем компаниям, у которых
// вообще есть временная папка.
function cleanupExpiredTmp() {
  if (!fs.existsSync(config.ordersTmpBaseDir)) return;
  const ttlMs = config.orderScanTtlMinutes * 60 * 1000;
  const now = Date.now();

  for (const companyId of fs.readdirSync(config.ordersTmpBaseDir)) {
    const dir = tmpDirFor(companyId);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of files) {
      try {
        const filePath = path.join(dir, name);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > ttlMs) fs.unlinkSync(filePath);
      } catch {
        // Пропускаем файл, если он уже удалён/недоступен — очистка не критична.
      }
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
