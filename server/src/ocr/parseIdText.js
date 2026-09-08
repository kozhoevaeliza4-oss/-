// Разбор "сырого" текста, который вернул общий OCR-движок (Yandex Vision),
// в структурированные поля документа. Общий OCR не заточен под ID-документы,
// поэтому парсинг полей — наша ответственность (см. README, "Выбор OCR-провайдера").
//
// Если/когда провайдер сменится на специализированный ID-SDK (Regula, Smart
// Engines, Microblink), эта функция, скорее всего, не понадобится вовсе —
// такие SDK возвращают уже разобранные поля напрямую.

const PIN_CANDIDATE_REGEX = /\b\d{14}\b/;
const DOC_NUMBER_LABEL_REGEX = /(ID\s?№?|№|N[oOо]?)\s*[:\s]*([A-Z0-9]{6,12})/i;
const FULL_NAME_LABEL_REGEX = /(Ф\.?\s?И\.?\s?О\.?|ФАМИЛИЯ|АТЫ-ЖӨНҮ)[:\s]*([А-ЯЁӨҮ][А-ЯЁӨҮа-яёөү\s-]{4,60})/i;

function parseIdText(rawText) {
  const text = String(rawText || '');

  const pinMatch = text.match(PIN_CANDIDATE_REGEX);
  const docNumberMatch = text.match(DOC_NUMBER_LABEL_REGEX);
  const fullNameMatch = text.match(FULL_NAME_LABEL_REGEX);

  return {
    pin: pinMatch ? pinMatch[0] : null,
    docNumber: docNumberMatch ? docNumberMatch[2] : null,
    fullName: fullNameMatch ? fullNameMatch[2].trim() : null,
  };
}

module.exports = { parseIdText };
