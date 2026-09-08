// Электронный реестр приказов (ТЗ п.4) + логика последовательной нумерации
// (ТЗ п.5).
//
// Хранилище — JSON-файл, как и server/src/db.js для сделок: этого достаточно
// для MVP на один процесс. Экспорт в Excel (см. routes/orders.js) закрывает
// требование "реестр как электронная таблица" без внешней зависимости от
// Google Sheets API/учётных данных — интеграция с Google Sheets/Excel Online
// вынесена в README как решение, требующее выбора конкретного API и
// учётных данных организации, не принимаемое разработчиком в одиночку.
//
// Защита от конфликтов нумерации при одновременной регистрации (ТЗ п.5.3):
// Node обрабатывает запросы в одном потоке, но `await` внутри обработчика
// (запись в файл, OCR-запрос) даёт возможность двум запросам "переплестись".
// Здесь это исключено сериализацией всех операций, присваивающих номер,
// через `withLock` — при этом чтение/запись файла и вычисление
// MAX(номер)+1 происходят как единая критическая секция. Для многопроцессной
// эксплуатации (несколько инстансов сервера) этого uже недостаточно — тогда
// нужна БД с транзакциями/уникальным индексом на номер (см. README).

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

function ensureDataFile() {
  const dir = path.dirname(config.ordersDataFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(config.ordersDataFile)) {
    fs.writeFileSync(config.ordersDataFile, '[]', 'utf8');
  }
}

function readAll() {
  ensureDataFile();
  const raw = fs.readFileSync(config.ordersDataFile, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(entries) {
  ensureDataFile();
  fs.writeFileSync(config.ordersDataFile, JSON.stringify(entries, null, 2), 'utf8');
}

// Простой promise-based мьютекс: каждый следующий вызов withLock ждёт
// завершения предыдущего, независимо от того, из какого запроса он пришёл.
let lockChain = Promise.resolve();
function withLock(fn) {
  const run = lockChain.then(fn, fn);
  // Держим цепочку живой даже если fn упал — иначе один сбой заблокирует
  // все последующие операции навсегда.
  lockChain = run.catch(() => {});
  return run;
}

function nextNumber(entries) {
  let max = 0;
  for (const entry of entries) {
    if (typeof entry.number === 'number' && entry.number > max) max = entry.number;
  }
  return max + 1;
}

// Регистрирует один приказ, атомарно присваивая следующий номер
// (MAX(номер)+1, ТЗ п.5.2). draft — уже проверенные пользователем поля.
function registerOne(draft) {
  return withLock(() => {
    const entries = readAll();
    const number = nextNumber(entries);
    const now = new Date().toISOString();
    const entry = {
      id: uuidv4(),
      number,
      date: draft.date || null,
      type: draft.type || null,
      employeeName: draft.employeeName || null,
      orgName: draft.orgName || null,
      summary: draft.summary || '',
      note: draft.note || '',
      registeredAt: now,
      filePath: draft.filePath || null,
      ocrRawText: draft.ocrRawText || '',
      ocrConfidence: draft.ocrConfidence ?? null,
      // "Требует проверки", если ключевые поля не распознаны уверенно
      // (ТЗ п.6) — иначе "Зарегистрирован".
      status: draft.needsReview ? 'needs_review' : 'registered',
      history: [{ at: now, action: 'created', by: draft.registeredBy || null }],
    };
    entries.push(entry);
    writeAll(entries);
    return entry;
  });
}

// Регистрирует несколько приказов одной атомарной операцией — используется
// при первичной загрузке (ТЗ п.3): номера присваиваются последовательно в
// порядке, который пользователь подтвердил в таблице предпросмотра, одним
// проходом внутри lock, чтобы никакая параллельная регистрация не
// "вклинилась" между записями пачки.
function registerBulk(drafts) {
  return withLock(() => {
    const entries = readAll();
    let counter = nextNumber(entries);
    const now = new Date().toISOString();
    const created = [];
    for (const draft of drafts) {
      const entry = {
        id: uuidv4(),
        number: counter,
        date: draft.date || null,
        type: draft.type || null,
        employeeName: draft.employeeName || null,
        orgName: draft.orgName || null,
        summary: draft.summary || '',
        note: draft.note || '',
        registeredAt: now,
        filePath: draft.filePath || null,
        ocrRawText: draft.ocrRawText || '',
        ocrConfidence: draft.ocrConfidence ?? null,
        status: draft.needsReview ? 'needs_review' : 'registered',
        history: [{ at: now, action: 'created_bulk', by: draft.registeredBy || null }],
      };
      counter += 1;
      entries.push(entry);
      created.push(entry);
    }
    writeAll(entries);
    return created;
  });
}

function getById(id) {
  return readAll().find((e) => e.id === id) || null;
}

// Привязывает сохранённый файл к записи после переноса из временного
// хранилища в постоянное (см. routes/orders.js, storage.moveToPermanent).
// Отдельно от updateEntry: это часть процесса регистрации, а не
// пользовательская правка, и не должно попадать в history как "edited".
function attachFile(id, filePath) {
  return withLock(() => {
    const entries = readAll();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    entry.filePath = filePath;
    writeAll(entries);
    return entry;
  });
}

// Правки не затрагивают номер (ТЗ п.5.4, п.11) — попытка передать number
// в patch игнорируется. Каждое изменение добавляется в history.
function updateEntry(id, patch, editedBy) {
  return withLock(() => {
    const entries = readAll();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;

    const editableFields = ['date', 'type', 'employeeName', 'orgName', 'summary', 'note'];
    const now = new Date().toISOString();
    for (const field of editableFields) {
      if (Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== entry[field]) {
        entry.history.push({
          at: now,
          action: 'edited',
          field,
          oldValue: entry[field],
          newValue: patch[field],
          by: editedBy || null,
        });
        entry[field] = patch[field];
      }
    }
    if (entry.status === 'needs_review' && patch.confirmReviewed) {
      entry.status = 'registered';
      entry.history.push({ at: now, action: 'review_confirmed', by: editedBy || null });
    }
    writeAll(entries);
    return entry;
  });
}

// Отмена/недействительность приказа (ТЗ п.5.4): номер остаётся в истории,
// не удаляется и не переиспользуется — меняется только статус.
function cancelEntry(id, reason, newStatus, actor) {
  const status = newStatus === 'invalid' ? 'invalid' : 'cancelled';
  return withLock(() => {
    const entries = readAll();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    const now = new Date().toISOString();
    entry.status = status;
    entry.history.push({ at: now, action: 'status_changed', newValue: status, reason: reason || null, by: actor || null });
    writeAll(entries);
    return entry;
  });
}

function search({ number, date, employeeName, type, q }) {
  const entries = readAll();
  return entries.filter((e) => {
    if (number && String(e.number) !== String(number)) return false;
    if (date && e.date !== date) return false;
    if (employeeName && !normalize(e.employeeName).includes(normalize(employeeName))) return false;
    if (type && !normalize(e.type).includes(normalize(type))) return false;
    if (q) {
      const haystack = normalize(
        [e.employeeName, e.type, e.summary, e.orgName, e.note, e.number].join(' ')
      );
      if (!haystack.includes(normalize(q))) return false;
    }
    return true;
  });
}

function normalize(value) {
  return String(value || '').toLowerCase();
}

module.exports = {
  readAll,
  writeAll,
  withLock,
  nextNumber,
  registerOne,
  registerBulk,
  getById,
  attachFile,
  updateEntry,
  cancelEntry,
  search,
};
