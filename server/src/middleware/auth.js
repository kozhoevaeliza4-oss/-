const config = require('../config');
const { getSession } = require('../auth/sessions');
const { findById } = require('../auth/companies');
const { parseCookies } = require('../utils/cookies');

// Проверяет сессию компании по cookie и привязывает запрос к конкретной
// компании (req.company) — все роуты данных (сделки, приказы) используют
// req.company.id, чтобы данные одной компании не были видны другой
// (см. README, "Мультиарендность").
function requireAuth(req, res, next) {
  const cookies = parseCookies(req.get('cookie'));
  const token = cookies[config.sessionCookieName];
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const company = findById(session.companyId);
  if (!company) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  req.company = { id: company.id, name: company.name, login: company.login };
  next();
}

module.exports = { requireAuth };
