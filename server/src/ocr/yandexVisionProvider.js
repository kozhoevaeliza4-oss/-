// Провайдер на базе Yandex Vision OCR.
//
// Выбран как стартовый вариант (см. README, "Выбор OCR-провайдера"):
// хорошо читает кириллицу и доступен в регионе, но это ОБЩИЙ OCR, не
// заточенный под ID-документы — структурированные поля из его ответа
// добываются отдельным парсером (см. ./parseIdText.js). Точность на MRZ
// и полях ID-карты КР нужно проверить на реальных тестовых образцах перед
// вводом в эксплуатацию; при необходимости заменить на специализированный
// ID-SDK (Regula / Smart Engines / Microblink), не меняя остальной модуль
// (см. ./provider.js).
//
// Ключ API читается только из переменных окружения сервера (config.js) и
// никогда не передаётся клиенту.

const OCR_ENDPOINT = 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText';

class YandexVisionProvider {
  constructor({ apiKey, folderId }) {
    this.apiKey = apiKey;
    this.folderId = folderId;
  }

  async scan(imageBuffer) {
    if (!this.apiKey) {
      throw new Error('YANDEX_VISION_API_KEY не задан на сервере');
    }

    const body = {
      mimeType: 'JPEG',
      languageCodes: ['ru', 'en'],
      model: 'page',
      content: imageBuffer.toString('base64'),
    };
    if (this.folderId) {
      body.folderId = this.folderId;
    }

    const response = await fetch(OCR_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4500),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Yandex Vision OCR error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const result = data && data.result;
    const textAnnotation = result && result.textAnnotation;
    const rawText = (textAnnotation && textAnnotation.fullText) || '';

    // Yandex Vision OCR не возвращает единый confidence по всему документу
    // в этом эндпоинте — берём null, парсер/валидатор в scanId.js в этом
    // случае опирается только на формат распознанных полей (п.8 ТЗ).
    return { rawText, providerConfidence: null };
  }
}

module.exports = { YandexVisionProvider };
