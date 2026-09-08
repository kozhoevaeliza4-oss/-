// Проверка вероятного дублирования приказа перед присвоением номера (ТЗ п.7).
//
// Сравнение учитывает дату, ФИО, вид приказа и похожесть краткого
// содержания. Возвращает отсортированный список кандидатов с оценкой
// совпадения 0..1 — окончательное решение (зарегистрировать как новый /
// открыть существующую запись / отменить) остаётся за пользователем,
// система только предупреждает.

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .trim();
}

function tokenSet(value) {
  return new Set(
    normalizeText(value)
      .split(/[^а-яёa-z0-9]+/i)
      .filter((t) => t.length > 2)
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Веса подобраны так, чтобы совпадение даты+ФИО+вида уже давало высокую
// оценку даже при слабом текстовом совпадении содержания (короткие приказы
// часто отличаются формулировками при идентичной сути).
const WEIGHTS = { date: 0.3, employeeName: 0.3, type: 0.2, summary: 0.2 };

function scoreCandidate(fields, entry) {
  let score = 0;
  const matched = [];

  if (fields.date && entry.date && fields.date === entry.date) {
    score += WEIGHTS.date;
    matched.push('дата');
  }

  if (
    fields.employeeName &&
    entry.employeeName &&
    normalizeText(fields.employeeName) === normalizeText(entry.employeeName)
  ) {
    score += WEIGHTS.employeeName;
    matched.push('ФИО');
  }

  if (fields.type && entry.type && fields.type === entry.type) {
    score += WEIGHTS.type;
    matched.push('вид приказа');
  }

  const summarySimilarity = jaccard(tokenSet(fields.summary), tokenSet(entry.summary));
  if (summarySimilarity >= 0.4) {
    score += WEIGHTS.summary * Math.min(summarySimilarity / 0.4, 1);
    matched.push('содержание');
  }

  return { score, matched };
}

function findDuplicates(fields, existingEntries, threshold) {
  const candidates = existingEntries
    .filter((entry) => entry.status !== 'cancelled' && entry.status !== 'invalid')
    .map((entry) => {
      const { score, matched } = scoreCandidate(fields, entry);
      return { entry, score, matched };
    })
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score);

  return candidates;
}

module.exports = { findDuplicates, scoreCandidate };
