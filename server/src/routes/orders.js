// Роуты системы регистрации и нумерации приказов.
// Архитектура (см. README, "Реестр приказов"):
//   фото -> OCR + парсинг -> проверка реестра -> проверка дублей ->
//   следующий номер -> подтверждение пользователя -> присвоение номера ->
//   запись в реестр -> сохранение фото -> номер пользователю.
//
// Регистрация двухэтапная (scan -> confirm) намеренно: номер нельзя
// присваивать до того, как пользователь увидел распознанные данные и либо
// подтвердил их, либо исправил (ТЗ п.6, п.8) — иначе неверно распознанные
// поля попадали бы в реестр как есть.

const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');

const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { getOcrProvider } = require('../ocr/provider');
const { parseOrderText } = require('../orders/parseOrderText');
const { findDuplicates } = require('../orders/duplicateCheck');
const registry = require('../orders/registry');
const storage = require('../orders/storage');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const OCR_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// Распознаёт один загруженный файл и возвращает разобранные поля +
// признак "нужна проверка", если ключевые поля (дата, вид, ФИО) не
// распознаны — система не должна придумывать данные (ТЗ п.6).
async function scanBuffer(buffer) {
  const provider = getOcrProvider();
  let rawText = '';
  let providerConfidence = null;
  let ocrFailed = false;

  try {
    const result = await withTimeout(provider.scan(buffer), OCR_TIMEOUT_MS);
    rawText = result.rawText;
    providerConfidence = result.providerConfidence;
  } catch {
    ocrFailed = true;
  }

  const parsed = ocrFailed
    ? { date: null, type: null, employeeName: null, orgName: null, existingNumber: null, summary: null }
    : parseOrderText(rawText);

  const belowThreshold =
    providerConfidence !== null && providerConfidence < config.ocrConfidenceThreshold;

  const fields = belowThreshold
    ? { date: null, type: null, employeeName: null, orgName: null, existingNumber: null, summary: null }
    : parsed;

  const needsReview = ocrFailed || !fields.date || !fields.type;

  return { fields, rawText, providerConfidence, needsReview, ocrFailed };
}

router.post('/orders/scan', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'photo is required (multipart field "photo")' });
  }

  const scan = await scanBuffer(req.file.buffer);
  const scanToken = storage.saveTmp(req.company.id, req.file.buffer, req.file.originalname);

  const existingEntries = registry.readAll(req.company.id);
  const duplicates = findDuplicates(scan.fields, existingEntries, config.orderDuplicateThreshold);
  const suggestedNumber = registry.nextNumber(existingEntries);

  res.json({
    scanToken,
    fields: scan.fields,
    ocrRawText: scan.rawText,
    ocrConfidence: scan.providerConfidence,
    needsReview: scan.needsReview,
    ocrFailed: scan.ocrFailed,
    suggestedNumber,
    duplicates: duplicates.map((d) => ({
      id: d.entry.id,
      number: d.entry.number,
      score: Number(d.score.toFixed(2)),
      matched: d.matched,
      date: d.entry.date,
      type: d.entry.type,
      employeeName: d.entry.employeeName,
    })),
  });
});

router.post('/orders/bulk-scan', requireAuth, upload.array('photos', 30), async (req, res) => {
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: 'photos is required (multipart field "photos", multiple files)' });
  }

  const items = [];
  for (const file of req.files) {
    const scan = await scanBuffer(file.buffer);
    const scanToken = storage.saveTmp(req.company.id, file.buffer, file.originalname);
    items.push({
      scanToken,
      originalName: file.originalname,
      fields: scan.fields,
      ocrRawText: scan.rawText,
      ocrConfidence: scan.providerConfidence,
      needsReview: scan.needsReview,
      ocrFailed: scan.ocrFailed,
    });
  }

  // Предварительная сортировка по дате (ТЗ п.3) — приказы без распознанной
  // даты уходят в конец и явно требуют проверки пользователем перед
  // подтверждением хронологии.
  items.sort((a, b) => {
    if (a.fields.date && b.fields.date) return a.fields.date.localeCompare(b.fields.date);
    if (a.fields.date) return -1;
    if (b.fields.date) return 1;
    return 0;
  });

  const existingEntries = registry.readAll(req.company.id);
  let suggested = registry.nextNumber(existingEntries);
  const preview = items.map((item) => ({ ...item, suggestedNumber: suggested++ }));

  res.json({ items: preview });
});

// Подтверждение одиночной регистрации (Сценарий А, ТЗ п.2). Номер
// присваивается здесь, только теперь, атомарно (registry.registerOne).
router.post('/orders/confirm', requireAuth, async (req, res) => {
  const body = req.body || {};
  const { scanToken, action } = body;

  if (!scanToken) {
    return res.status(400).json({ error: 'scanToken is required' });
  }

  if (action === 'cancel') {
    storage.deleteTmp(req.company.id, scanToken);
    return res.json({ cancelled: true });
  }

  if (action === 'open_existing') {
    const existing = body.existingId ? registry.getById(req.company.id, body.existingId) : null;
    if (!existing) return res.status(404).json({ error: 'existing entry not found' });
    storage.deleteTmp(req.company.id, scanToken);
    return res.json({ opened: existing });
  }

  const fields = body.fields || {};
  const draft = {
    date: fields.date || null,
    type: fields.type || null,
    employeeName: fields.employeeName || null,
    orgName: fields.orgName || null,
    summary: fields.summary || '',
    note: fields.note || '',
    ocrRawText: body.ocrRawText || '',
    ocrConfidence: body.ocrConfidence ?? null,
    needsReview: Boolean(body.needsReview),
    registeredBy: req.company.login,
  };

  const entry = await registry.registerOne(req.company.id, draft);
  const filePath = storage.moveToPermanent(req.company.id, scanToken, { number: entry.number, date: entry.date });
  if (filePath) {
    await registry.attachFile(req.company.id, entry.id, filePath);
    entry.filePath = filePath;
  }

  res.status(201).json({ entry });
});

// Подтверждение первичной массовой загрузки (ТЗ п.3). Принимает
// окончательный порядок и исправленные пользователем поля — номера
// присваиваются последовательно этому порядку одной атомарной операцией.
router.post('/orders/bulk-confirm', requireAuth, async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];

  if (!items.length) {
    return res.status(400).json({ error: 'items is required (non-empty array)' });
  }

  const registeredBy = req.company.login;
  const drafts = items.map((item) => {
    const fields = item.fields || {};
    return {
      date: fields.date || null,
      type: fields.type || null,
      employeeName: fields.employeeName || null,
      orgName: fields.orgName || null,
      summary: fields.summary || '',
      note: fields.note || '',
      ocrRawText: item.ocrRawText || '',
      ocrConfidence: item.ocrConfidence ?? null,
      needsReview: Boolean(item.needsReview),
      registeredBy,
      _scanToken: item.scanToken,
    };
  });

  const created = await registry.registerBulk(req.company.id, drafts);

  for (let i = 0; i < created.length; i += 1) {
    const entry = created[i];
    const scanToken = drafts[i]._scanToken;
    if (!scanToken) continue;
    const filePath = storage.moveToPermanent(req.company.id, scanToken, { number: entry.number, date: entry.date });
    if (filePath) {
      await registry.attachFile(req.company.id, entry.id, filePath);
      entry.filePath = filePath;
    }
  }

  res.status(201).json({ entries: created });
});

router.get('/orders/search', requireAuth, (req, res) => {
  const { number, date, employeeName, type, q } = req.query;
  const results = registry.search(req.company.id, { number, date, employeeName, type, q });
  res.json(results);
});

router.get('/orders/export', requireAuth, async (req, res) => {
  const entries = registry.readAll(req.company.id).sort((a, b) => (a.number || 0) - (b.number || 0));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Приказы');

  sheet.columns = [
    { header: 'Номер приказа', key: 'number', width: 14 },
    { header: 'Дата приказа', key: 'date', width: 14 },
    { header: 'Вид приказа', key: 'type', width: 30 },
    { header: 'ФИО сотрудника', key: 'employeeName', width: 28 },
    { header: 'Краткое содержание', key: 'summary', width: 40 },
    { header: 'Дата регистрации', key: 'registeredAt', width: 20 },
    { header: 'Файл', key: 'filePath', width: 30 },
    { header: 'Статус', key: 'status', width: 18 },
    { header: 'Примечание', key: 'note', width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  const reviewFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFF2CC' },
  };

  const STATUS_LABELS = {
    registered: 'Зарегистрирован',
    needs_review: 'Требует проверки',
    cancelled: 'Отменен',
    invalid: 'Недействителен',
  };

  for (const entry of entries) {
    const row = sheet.addRow({
      number: entry.number,
      date: entry.date,
      type: entry.type,
      employeeName: entry.employeeName,
      summary: entry.summary,
      registeredAt: entry.registeredAt,
      filePath: entry.filePath,
      status: STATUS_LABELS[entry.status] || entry.status,
      note: entry.note,
    });

    if (entry.status === 'needs_review') {
      row.eachCell((cell) => {
        cell.fill = reviewFill;
      });
    }
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="orders-registry.xlsx"');

  await workbook.xlsx.write(res);
  res.end();
});

router.get('/orders/:id/file', requireAuth, (req, res) => {
  const entry = registry.getById(req.company.id, req.params.id);
  if (!entry || !entry.filePath) return res.status(404).json({ error: 'file not found' });
  res.sendFile(storage.resolveStoredPath(req.company.id, entry.filePath));
});

router.get('/orders/:id', requireAuth, (req, res) => {
  const entry = registry.getById(req.company.id, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json(entry);
});

// Редактирование не меняет номер приказа (ТЗ п.5.4, п.11) — поле number в
// теле запроса, даже если передано, игнорируется registry.updateEntry.
router.patch('/orders/:id', requireAuth, async (req, res) => {
  const entry = await registry.updateEntry(req.company.id, req.params.id, req.body || {}, req.company.login);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json(entry);
});

router.post('/orders/:id/cancel', requireAuth, async (req, res) => {
  const { reason, status } = req.body || {};
  const entry = await registry.cancelEntry(req.company.id, req.params.id, reason, status, req.company.login);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json(entry);
});

module.exports = router;
