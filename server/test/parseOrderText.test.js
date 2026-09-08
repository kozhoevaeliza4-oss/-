const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOrderText } = require('../src/orders/parseOrderText');

test('parseOrderText extracts numeric date', () => {
  const result = parseOrderText('Приказ № 128 от 08.09.2026\nО предоставлении отпуска');
  assert.equal(result.date, '2026-09-08');
});

test('parseOrderText extracts worded date', () => {
  const result = parseOrderText('08 сентября 2026 г. Приказ о переводе сотрудника');
  assert.equal(result.date, '2026-09-08');
});

test('parseOrderText detects order type by keyword', () => {
  const result = parseOrderText('Приказ о предоставлении отпуска Иванову И.И.');
  assert.equal(result.type, 'Приказ о предоставлении отпуска');
});

test('parseOrderText extracts labeled full name', () => {
  const result = parseOrderText('ФИО: Иванов Иван Иванович\nПриказ об увольнении');
  assert.equal(result.employeeName, 'Иванов Иван Иванович');
});

test('parseOrderText extracts existing order number', () => {
  const result = parseOrderText('Приказ № 128 от 08.09.2026');
  assert.equal(result.existingNumber, '128');
});

test('parseOrderText returns nulls when nothing matches', () => {
  const result = parseOrderText('нечитаемый мусор от OCR без структуры');
  assert.equal(result.date, null);
  assert.equal(result.type, null);
  assert.equal(result.employeeName, null);
});
