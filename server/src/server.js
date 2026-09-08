const express = require('express');
const path = require('path');

const config = require('./config');
const dealsRouter = require('./routes/deals');
const scanIdRouter = require('./routes/scanId');
const ordersRouter = require('./routes/orders');
const { cleanupExpiredTmp } = require('./orders/storage');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

app.use('/api', dealsRouter);
app.use('/api', scanIdRouter);
app.use('/api', ordersRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Nurzaman deal form listening on http://localhost:${config.port}`);
});

// Неподтверждённые сканы приказов (см. server/src/orders/storage.js) со
// временем удаляются — очистка раз в час, не блокирует обработку запросов.
setInterval(cleanupExpiredTmp, 60 * 60 * 1000).unref();
