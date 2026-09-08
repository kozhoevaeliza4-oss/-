// Сессии — в памяти процесса, как и промис-мьютекс нумерации приказов
// (см. orders/registry.js): достаточно для одного инстанса сервера,
// осознанное ограничение MVP. При перезапуске сервера все сессии
// сбрасываются, пользователям нужно войти заново. Для многопроцессной
// эксплуатации нужно вынести сессии во внешнее хранилище (Redis и т.п.).

const crypto = require('crypto');
const config = require('../config');

const sessions = new Map();

function createSession(companyId) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttlMs = config.sessionTtlHours * 60 * 60 * 1000;
  sessions.set(token, { companyId, expiresAt: Date.now() + ttlMs });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

module.exports = { createSession, getSession, destroySession };
