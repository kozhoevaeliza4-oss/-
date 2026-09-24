const test = require('node:test');
const assert = require('node:assert');
const { createPgStore } = require('../src/store');

// Запускается только при наличии тестовой базы:
// TEST_DATABASE_URL=postgres://... npm test
const url = process.env.TEST_DATABASE_URL;

test('PostgreSQL: данные переживают перезапуск', { skip: !url && 'нет TEST_DATABASE_URL' }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url });
  await pool.query('DROP TABLE IF EXISTS app_state');

  const a = await createPgStore(null, { client: pool });
  assert.deepStrictEqual(a.data.tasks, []);
  a.data.tasks.push({ id: '1', title: 'Позвонить подрядчику' });
  a.save();
  a.data.secrets.vapidPublicKey = 'pub';
  a.save();
  a.save();
  await a.settle();

  const b = await createPgStore(null, { client: pool });
  assert.strictEqual(b.data.tasks[0].title, 'Позвонить подрядчику');
  assert.strictEqual(b.data.secrets.vapidPublicKey, 'pub');
  assert.deepStrictEqual(b.data.subscriptions, { assistant: [], boss: [] });
  await pool.query('DROP TABLE app_state');
  await pool.end();
});
