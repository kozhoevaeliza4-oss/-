const config = require('../config');

// Простая bearer-авторизация для внутренних пользователей (менеджеров).
// В реальной эксплуатации замените на полноценный SSO/сессии компании —
// это заглушка, достаточная, чтобы не оставлять эндпоинты полностью открытыми.
function requireAuth(req, res, next) {
  if (!config.apiAuthToken) {
    // Токен не настроен — считаем окружение локальным/dev.
    return next();
  }
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== config.apiAuthToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

module.exports = { requireAuth };
