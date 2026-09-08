const test = require('node:test');
const assert = require('node:assert/strict');
const { findDuplicates } = require('../src/orders/duplicateCheck');

const existing = [
  {
    id: 'e1',
    number: 115,
    date: '2026-09-08',
    type: 'Приказ о предоставлении отпуска',
    employeeName: 'Иванов Иван Иванович',
    summary: 'Предоставить ежегодный оплачиваемый отпуск Иванову И.И. с 10.09.2026',
    status: 'registered',
  },
];

test('findDuplicates flags matching date, name and type as likely duplicate', () => {
  const fields = {
    date: '2026-09-08',
    type: 'Приказ о предоставлении отпуска',
    employeeName: 'Иванов Иван Иванович',
    summary: 'Предоставить ежегодный оплачиваемый отпуск Иванову И.И. с 10.09.2026',
  };
  const result = findDuplicates(fields, existing, 0.7);
  assert.equal(result.length, 1);
  assert.equal(result[0].entry.number, 115);
  assert.ok(result[0].score >= 0.7);
});

test('findDuplicates does not flag unrelated order', () => {
  const fields = {
    date: '2026-01-01',
    type: 'Приказ о переводе',
    employeeName: 'Петров Петр Петрович',
    summary: 'Перевести Петрова П.П. на должность инженера',
  };
  const result = findDuplicates(fields, existing, 0.7);
  assert.equal(result.length, 0);
});

test('findDuplicates ignores cancelled entries', () => {
  const cancelled = [{ ...existing[0], status: 'cancelled' }];
  const fields = {
    date: '2026-09-08',
    type: 'Приказ о предоставлении отпуска',
    employeeName: 'Иванов Иван Иванович',
    summary: 'Предоставить ежегодный оплачиваемый отпуск Иванову И.И. с 10.09.2026',
  };
  const result = findDuplicates(fields, cancelled, 0.7);
  assert.equal(result.length, 0);
});
