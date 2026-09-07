const express = require('express');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');

const { requireAuth } = require('../middleware/auth');
const { readAll, writeAll } = require('../db');
const { validatePin, validateDocNumber } = require('../validation');

const router = express.Router();

function toBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

router.get('/deals', requireAuth, (_req, res) => {
  const deals = readAll();
  res.json(deals);
});

router.post('/deals', requireAuth, (req, res) => {
  const body = req.body || {};

  if (!body.fullName || !String(body.fullName).trim()) {
    return res.status(400).json({ error: 'fullName is required' });
  }
  // Согласие на обработку фото документа — отдельная строка от согласия
  // с условиями приобретения (п.7 ТЗ). Требуем явно, если фото ID вообще
  // использовалось в заявке (передан docNumber или pin).
  const usedIdPhoto = Boolean(body.docNumber || body.pin);
  if (usedIdPhoto && !toBool(body.photoConsent)) {
    return res.status(400).json({ error: 'photoConsent is required when ID document data is provided' });
  }

  const pinCheck = body.pin ? validatePin(body.pin) : { valid: false, value: null };
  const docCheck = body.docNumber ? validateDocNumber(body.docNumber) : { valid: false, value: null };

  const deal = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    fullName: String(body.fullName).trim(),
    phone: body.phone ? String(body.phone).trim() : '',
    docNumber: body.docNumber ? String(body.docNumber).trim() : '',
    // Подтверждено вручную менеджером (явное взаимодействие с полем), а не
    // просто "распознано с высокой уверенностью" — п.11 ТЗ запрещает
    // автоматическое подтверждение без действия пользователя.
    docNumberConfirmed: toBool(body.docNumberConfirmed),
    docNumberFormatValid: body.docNumber ? docCheck.valid : null,
    pin: body.pin ? String(body.pin).trim() : '',
    pinConfirmed: toBool(body.pinConfirmed),
    pinFormatValid: body.pin ? pinCheck.valid : null,
    photoConsent: toBool(body.photoConsent),
    agreementConsent: toBool(body.agreementConsent),
    notes: body.notes ? String(body.notes).trim() : '',
  };

  const deals = readAll();
  deals.push(deal);
  writeAll(deals);

  res.status(201).json(deal);
});

router.get('/deals/export', requireAuth, async (_req, res) => {
  const deals = readAll();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Сделки');

  sheet.columns = [
    { header: 'Дата', key: 'createdAt', width: 20 },
    { header: 'Ф.И.О.', key: 'fullName', width: 28 },
    { header: 'Телефон', key: 'phone', width: 16 },
    { header: 'Паспорт / ID №', key: 'docNumber', width: 16 },
    { header: 'ID № проверен менеджером', key: 'docNumberConfirmed', width: 20 },
    { header: 'ИНН (ПИН)', key: 'pin', width: 16 },
    { header: 'ПИН проверен менеджером', key: 'pinConfirmed', width: 20 },
    { header: 'Согласие на обработку фото документа', key: 'photoConsent', width: 24 },
    { header: 'Примечания', key: 'notes', width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  const unconfirmedFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFF2CC' }, // мягкий жёлтый — "требует перепроверки"
  };

  for (const deal of deals) {
    const row = sheet.addRow({
      createdAt: deal.createdAt,
      fullName: deal.fullName,
      phone: deal.phone,
      docNumber: deal.docNumber,
      docNumberConfirmed: deal.docNumberConfirmed ? 'да' : 'НЕТ — проверить',
      pin: deal.pin,
      pinConfirmed: deal.pinConfirmed ? 'да' : 'НЕТ — проверить',
      photoConsent: deal.photoConsent ? 'да' : 'нет',
      notes: deal.notes,
    });

    // Оформитель договора должен видеть, какие поля стоит перепроверить (п.9 ТЗ).
    if (deal.docNumber && !deal.docNumberConfirmed) {
      row.getCell('docNumber').fill = unconfirmedFill;
      row.getCell('docNumberConfirmed').fill = unconfirmedFill;
    }
    if (deal.pin && !deal.pinConfirmed) {
      row.getCell('pin').fill = unconfirmedFill;
      row.getCell('pinConfirmed').fill = unconfirmedFill;
    }
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="deals.xlsx"');

  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
