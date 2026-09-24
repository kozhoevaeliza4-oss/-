const path = require('path');

function loadDotEnv() {
  // Минимальный загрузчик .env, чтобы не тянуть зависимость ради пары строк.
  const file = path.join(__dirname, '..', '.env');
  let raw;
  try {
    raw = require('fs').readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

loadDotEnv();

const env = process.env;

module.exports = {
  port: Number(env.PORT) || 3000,
  pins: {
    assistant: env.ASSISTANT_PIN || '',
    boss: env.BOSS_PIN || '',
  },
  timezone: env.APP_TIMEZONE || 'Asia/Bishkek',
  reminderMinutes: Number(env.REMINDER_MINUTES) || 30,
  vapid: {
    subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
  },
  sessionSecret: env.SESSION_SECRET || '',
  dataFile: path.resolve(env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json')),
};
