const fs = require('fs');
const path = require('path');
const config = require('./config');

// Данные сделок хранятся по файлу на компанию (config.dealsDataDir/<companyId>.json)
// — это и есть изоляция данных между компаниями (см. README, "Мультиарендность").
function dealsFilePath(companyId) {
  return path.join(config.dealsDataDir, `${companyId}.json`);
}

function ensureDataFile(companyId) {
  if (!fs.existsSync(config.dealsDataDir)) fs.mkdirSync(config.dealsDataDir, { recursive: true });
  const file = dealsFilePath(companyId);
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
}

function readAll(companyId) {
  ensureDataFile(companyId);
  const raw = fs.readFileSync(dealsFilePath(companyId), 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(companyId, deals) {
  ensureDataFile(companyId);
  fs.writeFileSync(dealsFilePath(companyId), JSON.stringify(deals, null, 2), 'utf8');
}

module.exports = { readAll, writeAll };
