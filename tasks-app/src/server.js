const crypto = require('crypto');
const webpush = require('web-push');
const config = require('./config');
const { createStore, createPgStore } = require('./store');
const { createAuth, createLoginLimiter } = require('./auth');
const { createPusher } = require('./push');
const { createApp } = require('./app');
const { runReminders } = require('./reminders');

async function main() {
  const store = config.databaseUrl ? await createPgStore(config.databaseUrl) : createStore(config.dataFile);
  console.log(config.databaseUrl ? 'Данные хранятся в PostgreSQL' : `Данные хранятся в ${config.dataFile}`);
  const secrets = store.data.secrets;

  // Ключи, которые не заданы в окружении, создаём один раз и храним вместе с
  // данными: если они поменяются, телефоны перестанут получать уведомления.
  if (!config.vapid.publicKey || !config.vapid.privateKey) {
    if (!secrets.vapidPublicKey) {
      const keys = webpush.generateVAPIDKeys();
      secrets.vapidPublicKey = keys.publicKey;
      secrets.vapidPrivateKey = keys.privateKey;
    }
    config.vapid.publicKey = secrets.vapidPublicKey;
    config.vapid.privateKey = secrets.vapidPrivateKey;
  }
  if (!config.sessionSecret) {
    secrets.sessionSecret ||= crypto.randomBytes(32).toString('hex');
    config.sessionSecret = secrets.sessionSecret;
  }
  store.save();

  const pins = { ...config.pins };
  if (!pins.assistant || !pins.boss) {
    if (process.env.NODE_ENV === 'production') {
      console.error('Задайте ASSISTANT_PIN и BOSS_PIN в .env');
      process.exit(1);
    }
    pins.assistant ||= '1111';
    pins.boss ||= '2222';
    console.warn('⚠ PIN-коды не заданы, используются тестовые: ассистент 1111, руководитель 2222');
  }

  const send = createPusher({ store, vapid: config.vapid });
  const app = createApp({
    store,
    auth: createAuth({ secret: config.sessionSecret, pins }),
    limiter: createLoginLimiter(),
    send,
    timezone: config.timezone,
    reminderMinutes: config.reminderMinutes,
    vapidPublicKey: config.vapid.publicKey,
  });

  setInterval(() => {
    runReminders({
      store,
      send,
      now: Date.now(),
      timezone: config.timezone,
      reminderMinutes: config.reminderMinutes,
    });
  }, 20_000).unref();

  // За прокси хостинга (Render и т.п.) — число доверенных прокси, например TRUST_PROXY=1.
  const trustProxy = process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal';
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  app.listen(config.port, () => {
    console.log(`Задачи руководителя: http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Не удалось запустить сервер:', err.message);
  process.exit(1);
});
