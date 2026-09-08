const express = require('express');

const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { findByLogin } = require('../auth/companies');
const { verifyPassword } = require('../auth/passwords');
const { createSession, destroySession } = require('../auth/sessions');
const { parseCookies, serializeCookie } = require('../utils/cookies');

const router = express.Router();

router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  const company = login ? findByLogin(login) : null;

  // Одинаковое сообщение об ошибке для "нет такого логина" и "неверный
  // пароль" — не даём понять снаружи, существует ли такой логин.
  if (!company || !password || !verifyPassword(password, company.salt, company.passwordHash)) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Неверный логин или пароль' });
  }

  const token = createSession(company.id);
  res.setHeader(
    'Set-Cookie',
    serializeCookie(config.sessionCookieName, token, { maxAgeSeconds: config.sessionTtlHours * 60 * 60 })
  );
  res.json({ companyId: company.id, companyName: company.name });
});

router.post('/logout', (req, res) => {
  const cookies = parseCookies(req.get('cookie'));
  const token = cookies[config.sessionCookieName];
  if (token) destroySession(token);
  res.setHeader('Set-Cookie', serializeCookie(config.sessionCookieName, '', { maxAgeSeconds: 0 }));
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ companyId: req.company.id, companyName: req.company.name });
});

module.exports = router;
