const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIdText } = require('../src/ocr/parseIdText');

test('parseIdText extracts a 14-digit PIN candidate', () => {
  const result = parseIdText('ФИО: IVANOV IVAN\nПИН 12345678901234 конец');
  assert.equal(result.pin, '12345678901234');
});

test('parseIdText extracts labeled doc number', () => {
  const result = parseIdText('ID № AB1234567 выдан 2020');
  assert.equal(result.docNumber, 'AB1234567');
});

test('parseIdText returns nulls when nothing matches', () => {
  const result = parseIdText('какой-то нечитаемый мусор от OCR');
  assert.equal(result.pin, null);
  assert.equal(result.docNumber, null);
});
