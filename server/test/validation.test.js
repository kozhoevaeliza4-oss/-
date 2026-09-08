const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePin, validateDocNumber } = require('../src/validation');

test('validatePin accepts exactly 14 digits', () => {
  assert.deepEqual(validatePin('12345678901234'), { valid: true, value: '12345678901234' });
});

test('validatePin rejects wrong length', () => {
  assert.deepEqual(validatePin('123'), { valid: false, value: null });
  assert.deepEqual(validatePin('123456789012345'), { valid: false, value: null });
});

test('validatePin strips non-digits before checking length', () => {
  assert.deepEqual(validatePin('1234-5678-9012-34'), { valid: true, value: '12345678901234' });
});

test('validateDocNumber accepts alphanumeric within length bounds', () => {
  const result = validateDocNumber('ab1234567');
  assert.equal(result.valid, true);
  assert.equal(result.value, 'AB1234567');
});

test('validateDocNumber rejects too short values', () => {
  assert.deepEqual(validateDocNumber('AB12'), { valid: false, value: null });
});
