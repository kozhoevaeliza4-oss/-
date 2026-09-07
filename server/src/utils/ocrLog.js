// Логирование запросов к OCR для контроля расходов (п.10 ТЗ).
// ВАЖНО: само изображение никогда не попадает в лог — только метаданные.
function logOcrRequest({ requestId, provider, durationMs, outcome, error }) {
  const entry = {
    ts: new Date().toISOString(),
    requestId,
    provider,
    durationMs,
    outcome, // "ok" | "low_confidence" | "invalid_format" | "error" | "timeout"
    error: error ? String(error.message || error).slice(0, 300) : undefined,
  };
  // В проде — направить в централизованный лог/метрики (например, через
  // структурированный stdout-логгер + агрегатор). Здесь — простой stdout.
  // eslint-disable-next-line no-console
  console.log('[ocr]', JSON.stringify(entry));
}

module.exports = { logOcrRequest };
