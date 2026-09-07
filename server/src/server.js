const express = require('express');
const path = require('path');

const config = require('./config');
const dealsRouter = require('./routes/deals');
const scanIdRouter = require('./routes/scanId');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

app.use('/api', dealsRouter);
app.use('/api', scanIdRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Nurzaman deal form listening on http://localhost:${config.port}`);
});
