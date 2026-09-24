const crypto = require('crypto');

const ROLES = ['assistant', 'boss'];

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

// Токен = роль + подпись. PIN входит в ключ подписи, поэтому смена PIN
// в настройках сервера автоматически разлогинивает этого пользователя.
function createAuth({ secret, pins }) {
  function sign(role) {
    return crypto.createHmac('sha256', `${secret}:${pins[role]}`).update(role).digest('base64url');
  }

  return {
    checkPin(role, pin) {
      if (!ROLES.includes(role) || !pins[role]) return false;
      return safeEqual(pin ?? '', pins[role]);
    },
    issue(role) {
      return `${role}.${sign(role)}`;
    },
    verify(token) {
      if (typeof token !== 'string') return null;
      const [role, sig] = token.split('.');
      if (!ROLES.includes(role) || !sig) return null;
      return safeEqual(sig, sign(role)) ? role : null;
    },
  };
}

// Ограничение перебора PIN: не больше `max` неудачных попыток за окно.
function createLoginLimiter({ max = 5, windowMs = 60_000 } = {}) {
  const hits = new Map();
  return {
    blocked(key, now = Date.now()) {
      const h = hits.get(key);
      return Boolean(h && h.resetAt > now && h.count >= max);
    },
    fail(key, now = Date.now()) {
      const h = hits.get(key);
      if (!h || h.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
      else h.count += 1;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = { ROLES, createAuth, createLoginLimiter };
