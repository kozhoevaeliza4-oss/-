// Хэширование паролей учётных записей компаний. scrypt из встроенного
// `crypto` — без внешней зависимости (bcrypt и т.п.), с индивидуальной
// солью на пароль и сравнением через timingSafeEqual (защита от timing-атак).

const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEY_LENGTH).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const candidate = crypto.scryptSync(String(password), salt, KEY_LENGTH);
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

module.exports = { hashPassword, verifyPassword };
