# Браузерные проверки QA (Playwright)

Сценарии, которыми выполнялся аудит. Работают с **запущенным** приложением и создают отдельный тестовый
проект `QA-E2E-<метка>` с синтетическими данными. Не запускайте их на рабочей базе с реальными данными.

```bash
npm i --no-save playwright                      # браузер: npx playwright install chromium или свой путь в CHROMIUM_PATH
mkdir -p qa-data qa-out
npx tsx qa/e2e/mkdata.ts qa-data                # смета, фото АВР, выгрузка 1С и «плохие» файлы
QA_DATA_DIR=qa-data QA_OUT_DIR=qa-out node qa/e2e/full.mjs        # сквозной сценарий (24 шага)
QA_DATA_DIR=qa-data QA_OUT_DIR=qa-out node qa/e2e/neg.mjs <projectId>   # негативные сценарии
QA_OUT_DIR=qa-out node qa/e2e/mobile.mjs <projectId>              # горизонтальная прокрутка 390/768/1280 px
node qa/e2e/crawl.mjs                                             # обход страниц демо-проекта и экспортов
```

Переменные: `QA_BASE_URL` (по умолчанию http://localhost:3000), `QA_EMAIL`, `QA_PASSWORD` (по умолчанию значения из `.env.example`),
`CHROMIUM_PATH`. Скриншоты ошибок сохраняются в `QA_OUT_DIR`. `crawl.mjs` ожидает демо-проект (`npm run db:demo`).
