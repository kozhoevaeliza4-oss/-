// Хранилище учётных записей компаний (одна учётка = одна компания).
// Заполняется скриптом server/scripts/seedCompanies.js, не через API —
// заведение новой компании/учётки требует организационного решения
// (кто получает доступ), а не самостоятельного решения приложения.

const fs = require('fs');
const path = require('path');
const config = require('../config');

function ensureFile() {
  const dir = path.dirname(config.companiesFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(config.companiesFile)) {
    fs.writeFileSync(config.companiesFile, '[]', 'utf8');
  }
}

function readCompanies() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(config.companiesFile, 'utf8'));
  } catch {
    return [];
  }
}

function writeCompanies(companies) {
  ensureFile();
  fs.writeFileSync(config.companiesFile, JSON.stringify(companies, null, 2), 'utf8');
}

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

function findByLogin(login) {
  const normalized = normalizeLogin(login);
  return readCompanies().find((c) => c.login === normalized) || null;
}

function findById(id) {
  return readCompanies().find((c) => c.id === id) || null;
}

module.exports = { readCompanies, writeCompanies, findByLogin, findById, normalizeLogin };
