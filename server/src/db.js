const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureDataFile() {
  const dir = path.dirname(config.dataFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(config.dataFile)) fs.writeFileSync(config.dataFile, '[]', 'utf8');
}

function readAll() {
  ensureDataFile();
  const raw = fs.readFileSync(config.dataFile, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(deals) {
  ensureDataFile();
  fs.writeFileSync(config.dataFile, JSON.stringify(deals, null, 2), 'utf8');
}

module.exports = { readAll, writeAll };
