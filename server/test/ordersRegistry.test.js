const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../src/config');

// Реестр приказов читает config.ordersDataDir динамически при каждом
// вызове (не кэширует путь при require) — можно безопасно подменить его на
// временную директорию для изоляции тестов друг от друга и от боевых данных.
config.ordersDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-test-'));

const registry = require('../src/orders/registry');

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

test.after(() => {
  fs.rmSync(config.ordersDataDir, { recursive: true, force: true });
});

test('registerOne assigns sequential numbers starting at 1', async () => {
  const first = await registry.registerOne(COMPANY_A, { date: '2026-09-08', type: 'Приказ о переводе' });
  const second = await registry.registerOne(COMPANY_A, { date: '2026-09-09', type: 'Приказ об увольнении' });
  assert.equal(first.number, 1);
  assert.equal(second.number, 2);
});

test('registerOne serializes concurrent registrations without duplicate numbers', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      registry.registerOne(COMPANY_A, { date: '2026-09-10', type: `Тест ${i}` })
    )
  );
  const numbers = results.map((r) => r.number);
  const uniqueNumbers = new Set(numbers);
  assert.equal(uniqueNumbers.size, numbers.length, 'no two concurrent registrations share a number');
});

test('registerBulk assigns a contiguous sequential block', async () => {
  const before = registry.nextNumber(registry.readAll(COMPANY_A));
  const created = await registry.registerBulk(COMPANY_A, [
    { date: '2020-01-01', type: 'A' },
    { date: '2020-01-02', type: 'B' },
    { date: '2020-01-03', type: 'C' },
  ]);
  assert.deepEqual(created.map((e) => e.number), [before, before + 1, before + 2]);
});

test('updateEntry never changes the assigned number and records history', async () => {
  const entry = await registry.registerOne(COMPANY_A, { date: '2026-09-11', type: 'Приказ о премировании' });
  const updated = await registry.updateEntry(COMPANY_A, entry.id, { number: 9999, type: 'Исправленный вид' });
  assert.equal(updated.number, entry.number);
  assert.equal(updated.type, 'Исправленный вид');
  assert.ok(updated.history.some((h) => h.action === 'edited' && h.field === 'type'));
});

test('cancelEntry changes status but keeps the number reserved', async () => {
  const entry = await registry.registerOne(COMPANY_A, { date: '2026-09-12', type: 'Приказ о переводе' });
  const cancelled = await registry.cancelEntry(COMPANY_A, entry.id, 'ошибка', 'cancelled', 'tester');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.number, entry.number);

  const next = await registry.registerOne(COMPANY_A, { date: '2026-09-13', type: 'Другой приказ' });
  assert.notEqual(next.number, entry.number, 'cancelled number is never reused');
});

test('companies have fully isolated numbering and cannot see each other\'s entries', async () => {
  const aEntry = await registry.registerOne(COMPANY_A, { date: '2026-09-14', type: 'Приказ A' });
  const bEntry = await registry.registerOne(COMPANY_B, { date: '2026-09-14', type: 'Приказ B' });

  // У компании B своя последовательность номеров, независимая от A.
  assert.equal(bEntry.number, 1);
  assert.notEqual(aEntry.number, 1);

  assert.equal(registry.getById(COMPANY_B, aEntry.id), null, 'company B cannot read company A entry by id');
  assert.equal(registry.getById(COMPANY_A, bEntry.id), null, 'company A cannot read company B entry by id');

  const bSearch = registry.search(COMPANY_B, {});
  assert.ok(!bSearch.some((e) => e.id === aEntry.id), 'search for B never returns A entries');
});
