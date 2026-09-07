const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { getOcrProvider } = require('../ocr/provider');
const { parseIdText } = require('../ocr/parseIdText');
const { validatePin, validateDocNumber } = require('../validation');
const { logOcrRequest } = require('../utils/ocrLog');

const router = express.Router();

// Фото хранится ТОЛЬКО в памяти процесса на время запроса и никогда не
// пишется на диск и не сохраняется после ответа (п.7, п.11 ТЗ — "не хранить
// исходное фото дольше срока... не отправлять фото ни на один сторонний
// сервис, кроме согласованного OCR-провайдера"). Буфер уходит в GC сразу
// после того, как обработчик отдаёт ответ.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — с запасом под сжатое клиентом JPEG
});

const REQUEST_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

router.post('/scan-id', requireAuth, upload.single('photo'), async (req, res) => {
  const requestId = uuidv4();
  const startedAt = Date.now();
  const provider = getOcrProvider();

  if (!req.file) {
    return res.status(400).json({ error: 'photo is required (multipart field "photo")' });
  }

  try {
    const { rawText, providerConfidence } = await withTimeout(
      provider.scan(req.file.buffer),
      REQUEST_TIMEOUT_MS
    );

    const parsed = parseIdText(rawText);
    const pinResult = validatePin(parsed.pin);
    const docNumberResult = validateDocNumber(parsed.docNumber);

    // Порог уверенности (п.8 ТЗ). Если провайдер не отдаёт confidence,
    // полагаемся только на валидацию формата, но не блокируем результат.
    const belowThreshold =
      providerConfidence !== null && providerConfidence < config.ocrConfidenceThreshold;

    const result = {
      requestId,
      confidence: providerConfidence,
      fields: {
        pin: !belowThreshold && pinResult.valid ? pinResult.value : null,
        docNumber: !belowThreshold && docNumberResult.valid ? docNumberResult.value : null,
        fullName: !belowThreshold ? parsed.fullName || null : null,
      },
      // Автоподставленные поля никогда не считаются подтверждёнными —
      // подтверждение возможно только явным действием менеджера на клиенте
      // (п.9, п.11 ТЗ).
      autoFilled: true,
    };

    const outcome = belowThreshold
      ? 'low_confidence'
      : pinResult.valid || docNumberResult.valid
        ? 'ok'
        : 'invalid_format';

    logOcrRequest({
      requestId,
      provider: config.ocrProvider,
      durationMs: Date.now() - startedAt,
      outcome,
    });

    return res.json(result);
  } catch (err) {
    const outcome = err && err.message === 'timeout' ? 'timeout' : 'error';
    logOcrRequest({
      requestId,
      provider: config.ocrProvider,
      durationMs: Date.now() - startedAt,
      outcome,
      error: err,
    });

    // Провайдер недоступен/лимит/таймаут — форма не должна падать,
    // отдаём явный признак неудачи, чтобы фронт показал fallback (п.9, п.10 ТЗ).
    return res.status(502).json({
      requestId,
      error: 'ocr_unavailable',
      message: 'Не удалось распознать документ. Введите данные вручную.',
    });
  }
});

module.exports = router;
