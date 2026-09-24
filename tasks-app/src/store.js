const fs = require('fs');
const path = require('path');

const EMPTY = () => ({
  tasks: [],
  subscriptions: { assistant: [], boss: [] },
  secrets: {},
});

// Хранилище в одном JSON-файле: для двух пользователей и сотен задач этого
// более чем достаточно. Запись атомарная (через временный файл + rename),
// чтобы сбой посреди записи не испортил данные.
function createStore(file) {
  let data = EMPTY();

  if (file && fs.existsSync(file)) {
    try {
      data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      data.subscriptions = { assistant: [], boss: [], ...data.subscriptions };
    } catch (err) {
      const backup = `${file}.broken-${Date.now()}`;
      fs.copyFileSync(file, backup);
      console.error(`Не удалось прочитать ${file}, копия сохранена в ${backup}:`, err.message);
    }
  }

  function save() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  return {
    get data() {
      return data;
    },
    save,
  };
}

module.exports = { createStore };

// Хранилище в PostgreSQL (например, бесплатный Neon) — для хостингов без
// постоянного диска. Весь документ лежит одной строкой jsonb; записи идут
// строго по очереди, и в базу всегда уходит последнее состояние.
async function createPgStore(connectionString, { client } = {}) {
  let db = client;
  if (!db) {
    const { Pool } = require('pg');
    db = new Pool({ connectionString, max: 2 });
  }
  await db.query('CREATE TABLE IF NOT EXISTS app_state (id text PRIMARY KEY, data jsonb NOT NULL)');
  const { rows } = await db.query("SELECT data FROM app_state WHERE id = 'main'");
  const data = { ...EMPTY(), ...(rows[0]?.data || {}) };
  data.subscriptions = { assistant: [], boss: [], ...data.subscriptions };

  let writing = null;
  let dirty = false;

  async function flush() {
    while (dirty) {
      dirty = false;
      try {
        await db.query(
          "INSERT INTO app_state (id, data) VALUES ('main', $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
          [JSON.stringify(data)],
        );
      } catch (err) {
        console.error('Не удалось сохранить в базу, повтор через 5 с:', err.message);
        dirty = true;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    writing = null;
  }

  return {
    get data() {
      return data;
    },
    save() {
      dirty = true;
      writing ||= flush();
    },
    // Дождаться, пока все изменения попадут в базу (для тестов и остановки).
    async settle() {
      while (writing) await writing;
    },
    close: () => (client ? undefined : db.end()),
  };
}

module.exports.createPgStore = createPgStore;
