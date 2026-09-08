#!/usr/bin/env node
// Заводит учётные записи компаний (логин+пароль). Не вызывается из API —
// решение о том, кто получает доступ, организационное (см. README,
// "Мультиарендность"), поэтому это разовый скрипт, а не самообслуживание.
//
// Запуск: node server/scripts/seedCompanies.js
// Пароли выводятся в консоль один раз — их нужно сохранить сразу,
// повторно посмотреть их будет нельзя (хранится только хэш).

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('../src/auth/passwords');
const { readCompanies, writeCompanies, normalizeLogin } = require('../src/auth/companies');

const COMPANIES = [
  { login: 'nurzaman-yug', name: 'ОсОО СК «Нурзаман-Юг»' },
  { login: 'nurzaman-group', name: 'ОсОО СК «Нурзаман-групп»' },
  { login: 'nurzaman-trc', name: 'ОсОО ТРЦ «Нурзаман»' },
  { login: 'nurzaman-plaza', name: 'ОсОО «Нурзаман плаза»' },
];

function randomPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

function main() {
  const existing = readCompanies();
  const created = [];

  for (const def of COMPANIES) {
    const login = normalizeLogin(def.login);
    if (existing.find((c) => c.login === login)) {
      console.log(`Пропуск: логин "${login}" уже существует`);
      continue;
    }
    const password = randomPassword();
    const { salt, hash } = hashPassword(password);
    const company = {
      id: uuidv4(),
      login,
      name: def.name,
      salt,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    };
    existing.push(company);
    created.push({ name: def.name, login, password });
  }

  writeCompanies(existing);

  if (!created.length) {
    console.log('Новых учётных записей не создано.');
    return;
  }

  console.log('\nСозданы учётные записи (пароли показываются один раз — сохраните их сейчас):\n');
  for (const c of created) {
    console.log(`${c.name}\n  логин:  ${c.login}\n  пароль: ${c.password}\n`);
  }
}

main();
