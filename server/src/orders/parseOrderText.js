// Разбор "сырого" текста OCR приказа в структурированные поля.
//
// Общий OCR-движок (см. server/src/ocr/provider.js) отдаёт неразмеченный
// текст — извлечение полей приказа (дата, вид, ФИО, орг-я, уже указанный
// номер) остаётся ответственностью этого модуля, как и для parseIdText.js.
//
// Принцип из ТЗ (п.6): если поле не удаётся распознать с достаточной
// уверенностью — возвращаем null, а не придумываем значение. Решение о
// статусе записи ("Требуется проверка") принимается выше, в роуте.

const MONTHS_RU = {
  'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4, 'ма': 5, 'июн': 6,
  'июл': 7, 'август': 8, 'сентябр': 9, 'октябр': 10, 'ноябр': 11, 'декабр': 12,
};

const NUMERIC_DATE_REGEX = /\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/;
const WORD_DATE_REGEX = /\b(\d{1,2})\s+([А-Яа-яё]+)\s+(\d{4})\s*г?\.?/i;

const ORDER_NUMBER_REGEX = /(приказ[а-я]*\s*)?№\s*([0-9]{1,6}[a-zа-я]?)/i;

const ORDER_TYPE_KEYWORDS = [
  { type: 'Приказ о приеме на работу', words: ['приём на работу', 'прием на работу', 'принять на работу', 'о приеме', 'о приёме'] },
  { type: 'Приказ об увольнении', words: ['увольнени', 'расторжени', 'прекращени'] },
  { type: 'Приказ о предоставлении отпуска', words: ['отпуск'] },
  { type: 'Приказ о переводе', words: ['перевод'] },
  { type: 'Приказ о премировании', words: ['премировани', 'премии'] },
  { type: 'Приказ о дисциплинарном взыскании', words: ['выговор', 'дисциплинарн'] },
  { type: 'Приказ о командировке', words: ['командировк'] },
];

const FULL_NAME_LABEL_REGEX = /(Ф\.?\s?И\.?\s?О\.?|СОТРУДНИК[АУ]?)[:\s]*([А-ЯЁ][А-ЯЁа-яё-]+\s+[А-ЯЁ][А-ЯЁа-яё-]+\s+[А-ЯЁ][А-ЯЁа-яё-]+)/i;
// Запасной эвристический вариант: три подряд идущих слова с заглавной буквы
// (Фамилия Имя Отчество), не привязанные к явной метке "ФИО".
const FULL_NAME_BARE_REGEX = /\b([А-ЯЁ][а-яё-]+)\s+([А-ЯЁ][а-яё-]+)\s+([А-ЯЁ][а-яё-]+(?:ича|овна|евна|ич))\b/;

const ORG_LABEL_REGEX = /(ООО|ОсОО|ЗАО|ОАО|ИП)\s*[«"]?([^«»"\n]{2,60})[»"]?/;

function monthFromWord(word) {
  const lower = String(word || '').toLowerCase();
  for (const stem of Object.keys(MONTHS_RU)) {
    if (lower.startsWith(stem)) return MONTHS_RU[stem];
  }
  return null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDate(text) {
  const numeric = text.match(NUMERIC_DATE_REGEX);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  const worded = text.match(WORD_DATE_REGEX);
  if (worded) {
    const day = Number(worded[1]);
    const month = monthFromWord(worded[2]);
    const year = Number(worded[3]);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  return null;
}

function parseOrderType(text) {
  const lower = text.toLowerCase();
  for (const entry of ORDER_TYPE_KEYWORDS) {
    if (entry.words.some((w) => lower.includes(w))) {
      return entry.type;
    }
  }
  return null;
}

function parseFullName(text) {
  const labeled = text.match(FULL_NAME_LABEL_REGEX);
  if (labeled) return labeled[2].replace(/\s+/g, ' ').trim();

  const bare = text.match(FULL_NAME_BARE_REGEX);
  if (bare) return `${bare[1]} ${bare[2]} ${bare[3]}`;

  return null;
}

function parseOrgName(text) {
  const match = text.match(ORG_LABEL_REGEX);
  if (!match) return null;
  return `${match[1]} «${match[2].trim()}»`;
}

function parseExistingNumber(text) {
  const match = text.match(ORDER_NUMBER_REGEX);
  if (!match) return null;
  return match[2];
}

// Краткое содержание — первая содержательная строка текста, отличная от
// заголовка/органиции/номера, как черновой вариант для ручной проверки
// пользователем (не выдаётся за окончательный "summary").
function parseSummary(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const candidate = lines.find(
    (l) => l.length > 15 && !/^приказ\b/i.test(l) && !ORG_LABEL_REGEX.test(l)
  );
  return candidate || null;
}

function parseOrderText(rawText) {
  const text = String(rawText || '');
  return {
    date: parseDate(text),
    type: parseOrderType(text),
    employeeName: parseFullName(text),
    orgName: parseOrgName(text),
    existingNumber: parseExistingNumber(text),
    summary: parseSummary(text),
  };
}

module.exports = { parseOrderText };
