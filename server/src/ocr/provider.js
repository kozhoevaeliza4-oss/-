const config = require('../config');
const { YandexVisionProvider } = require('./yandexVisionProvider');
const { MockProvider } = require('./mockProvider');

// Общий контракт провайдера распознавания.
// scan(imageBuffer) -> Promise<{ rawText: string, providerConfidence: number|null }>
//
// Держим OCR-провайдер за этим интерфейсом намеренно: выбор провайдера
// зафиксирован в ТЗ (п.6) как решение "до старта разработки", но сама
// реализация должна быть заменяемой без переписывания остального модуля —
// например, при переходе на специализированный ID-SDK.
function getOcrProvider() {
  switch (config.ocrProvider) {
    case 'yandex':
      return new YandexVisionProvider({
        apiKey: config.yandexVisionApiKey,
        folderId: config.yandexVisionFolderId,
      });
    case 'mock':
    default:
      return new MockProvider();
  }
}

module.exports = { getOcrProvider };
