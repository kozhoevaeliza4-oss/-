const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../src/config');
config.companiesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'companies-test-')), 'companies.json');

const { hashPassword, verifyPassword } = require('../src/auth/passwords');
const companies = require('../src/auth/companies');
const { createSession, getSession, destroySession } = require('../src/auth/sessions');

test('hashPassword + verifyPassword accept the correct password and reject others', () => {
  const { salt, hash } = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', salt, hash), true);
  assert.equal(verifyPassword('wrong password', salt, hash), false);
});

test('findByLogin is case-insensitive and only matches seeded companies', () => {
  const { salt, hash } = hashPassword('secret123');
  companies.writeCompanies([{ id: 'c1', login: 'acme', name: 'ACME', salt, passwordHash: hash }]);

  const found = companies.findByLogin('ACME');
  assert.ok(found);
  assert.equal(found.id, 'c1');
  assert.equal(companies.findByLogin('nobody'), null);
});

test('sessions resolve to the company that created them and expire on destroy', () => {
  const token = createSession('company-x');
  assert.equal(getSession(token).companyId, 'company-x');
  destroySession(token);
  assert.equal(getSession(token), null);
});

test('an unknown session token resolves to nothing', () => {
  assert.equal(getSession('does-not-exist'), null);
});
