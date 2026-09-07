// Провайдер-заглушка для локальной разработки/тестов, чтобы не делать
// реальных внешних запросов и не требовать ключа. Никогда не должен
// использоваться в проде (см. OCR_PROVIDER в .env).
class MockProvider {
  async scan(_imageBuffer) {
    return {
      rawText: 'ФИО: TESTOV TEST TESTOVICH\nID № AB1234567\n12345678901234',
      providerConfidence: 0.95,
    };
  }
}

module.exports = { MockProvider };
