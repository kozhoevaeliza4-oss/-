// Валидация распознанных полей ID-документа.
// Требование ТЗ п.8: если формат не совпадает — поле не подставляется,
// остаётся пустым для ручного ввода.

const PIN_KG_REGEX = /^\d{14}$/;

// Формат номера ID-карты КР не является строго фиксированным во всех
// источниках (встречаются варианты вида "ID1234567" и чисто цифровые серии
// паспорта СССР/КР старого образца). Здесь заложен допускающий, но не
// пустой формат: 6-12 буквенно-цифровых символов. Перед вводом в
// эксплуатацию его нужно уточнить на реальных тестовых образцах документов
// у выбранного OCR-провайдера (см. README, раздел "Выбор OCR-провайдера").
const DOC_NUMBER_REGEX = /^[A-Z0-9]{6,12}$/;

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeDocNumber(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function validatePin(rawPin) {
  const digits = normalizeDigits(rawPin);
  if (PIN_KG_REGEX.test(digits)) {
    return { valid: true, value: digits };
  }
  return { valid: false, value: null };
}

function validateDocNumber(rawDocNumber) {
  const normalized = normalizeDocNumber(rawDocNumber);
  if (DOC_NUMBER_REGEX.test(normalized)) {
    return { valid: true, value: normalized };
  }
  return { valid: false, value: null };
}

module.exports = {
  PIN_KG_REGEX,
  DOC_NUMBER_REGEX,
  validatePin,
  validateDocNumber,
};
