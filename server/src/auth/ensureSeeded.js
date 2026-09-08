// Автозасев учётных записей компаний при первом запуске сервера — если
// файл компаний ещё не существует / пуст. Нужен для хостингов без доступа
// к консоли (например, бесплатный веб-сервис на Render, где нельзя просто
// зайти и выполнить `npm run seed:companies`): при первом старте сервер
// сам создаёт учётки и печатает пароли в лог приложения — это тот способ,
// которым такие пароли можно там увидеть один раз (логи деплоя).
//
// Если файл компаний уже существует (в том числе создан вручную через
// npm run seed:companies) — автозасев ничего не делает.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('./passwords');
const { readCompanies, writeCompanies, normalizeLogin } = require('./companies');
const { DEFAULT_COMPANIES } = require('./seedDefaults');

function randomPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

function ensureSeeded() {
  const existing = readCompanies();
  if (existing.length) return;

  const created = [];
  for (const def of DEFAULT_COMPANIES) {
    const login = normalizeLogin(def.login);
    const password = randomPassword();
    const { salt, hash } = hashPassword(password);
    existing.push({
      id: uuidv4(),
      login,
      name: def.name,
      salt,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    });
    created.push({ name: def.name, login, password });
  }
  writeCompanies(existing);

  // eslint-disable-next-line no-console
  console.log('\n=== Автосозданы учётные записи компаний (пароли видны только сейчас, в этом логе) ===\n');
  for (const c of created) {
    // eslint-disable-next-line no-console
    console.log(`${c.name}\n  логин:  ${c.login}\n  пароль: ${c.password}\n`);
  }
  // eslint-disable-next-line no-console
  console.log('=== Сохраните пароли — при следующем запуске этот вывод не повторится ===\n');
}

module.exports = { ensureSeeded };
