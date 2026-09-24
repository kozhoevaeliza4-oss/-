const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { createAuth, createLoginLimiter } = require('../src/auth');

const TZ = 'Asia/Bishkek';

async function setup() {
  const store = createStore(null);
  const sent = [];
  let clock = Date.parse('2026-09-24T06:00:00Z'); // 12:00 в Бишкеке
  const auth = createAuth({ secret: 'test', pins: { assistant: '1111', boss: '2222' } });
  const app = createApp({
    store,
    auth,
    limiter: createLoginLimiter({ max: 3 }),
    send: (role, payload) => sent.push({ role, ...payload }),
    clock: () => clock,
    timezone: TZ,
    reminderMinutes: 30,
    vapidPublicKey: 'pub',
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  return {
    store,
    sent,
    call,
    setClock: (iso) => { clock = Date.parse(iso); },
    close: () => new Promise((r) => { app.closeStreams(); server.close(r); }),
  };
}

test('основной сценарий: ассистент добавляет, руководитель выполняет', async (t) => {
  const s = await setup();
  t.after(s.close);

  const bad = await s.call('POST', '/login', { body: { role: 'boss', pin: '0000' } });
  assert.strictEqual(bad.status, 401);

  const a = (await s.call('POST', '/login', { body: { role: 'assistant', pin: '1111' } })).body.token;
  const b = (await s.call('POST', '/login', { body: { role: 'boss', pin: '2222' } })).body.token;

  assert.strictEqual((await s.call('GET', '/tasks')).status, 401);

  const created = await s.call('POST', '/tasks', {
    token: a,
    body: { title: 'Позвонить подрядчику', description: 'Обсудить сроки строительства', date: '2026-09-24', time: '15:00', priority: 'high' },
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.status, 'pending');
  assert.strictEqual(created.body.dueAt, Date.parse('2026-09-24T09:00:00Z'));
  assert.deepStrictEqual(s.sent.pop(), {
    role: 'boss',
    title: 'Новая задача',
    body: 'Позвонить подрядчику — сегодня в 15:00',
    tag: `task-${created.body.id}`,
    taskId: created.body.id,
  });

  // Руководитель не может создавать и редактировать задачи.
  assert.strictEqual((await s.call('POST', '/tasks', { token: b, body: { title: 'x', date: '2026-09-24' } })).status, 403);
  assert.strictEqual((await s.call('PATCH', `/tasks/${created.body.id}`, { token: b, body: { title: 'x' } })).status, 403);

  const list = await s.call('GET', '/tasks', { token: b });
  assert.strictEqual(list.body.today, '2026-09-24');
  assert.strictEqual(list.body.tasks.length, 1);
  assert.ok(!('remindedAt' in list.body.tasks[0]));

  const done = await s.call('POST', `/tasks/${created.body.id}/done`, { token: b, body: { done: true } });
  assert.strictEqual(done.body.status, 'done');
  assert.deepStrictEqual(s.sent.pop(), {
    role: 'assistant', title: 'Выполнено', body: 'Позвонить подрядчику', tag: `done-${created.body.id}`, taskId: created.body.id,
  });

  // Ассистент видит выполнение.
  const seen = await s.call('GET', '/tasks', { token: a });
  assert.strictEqual(seen.body.tasks[0].status, 'done');

  // Отмена по ошибке нажатого «Выполнить».
  const undo = await s.call('POST', `/tasks/${created.body.id}/done`, { token: b, body: { done: false } });
  assert.strictEqual(undo.body.status, 'pending');
  assert.strictEqual(s.sent.length, 0);
});

test('просрочка, редактирование и удаление', async (t) => {
  const s = await setup();
  t.after(s.close);
  const a = (await s.call('POST', '/login', { body: { role: 'assistant', pin: '1111' } })).body.token;

  const task = (await s.call('POST', '/tasks', { token: a, body: { title: 'Подписать договор', date: '2026-09-24', time: '12:20' } })).body;
  // До задачи 20 минут — отдельного напоминания не будет, уже пришло «Новая задача».
  assert.ok(s.store.data.tasks[0].remindedAt);

  s.setClock('2026-09-24T06:30:00Z'); // 12:30
  assert.strictEqual((await s.call('GET', '/tasks', { token: a })).body.tasks[0].status, 'overdue');

  s.sent.length = 0;
  const moved = await s.call('PATCH', `/tasks/${task.id}`, { token: a, body: { time: '17:00' } });
  assert.strictEqual(moved.body.status, 'pending');
  assert.strictEqual(moved.body.dueAt, Date.parse('2026-09-24T11:00:00Z'));
  assert.strictEqual(s.store.data.tasks[0].remindedAt, null);
  assert.strictEqual(s.sent[0].title, 'Задача изменена');
  assert.strictEqual(s.sent[0].body, 'Подписать договор — сегодня в 17:00');

  // Изменение только описания не беспокоит руководителя.
  s.sent.length = 0;
  await s.call('PATCH', `/tasks/${task.id}`, { token: a, body: { description: 'в двух экземплярах' } });
  assert.strictEqual(s.sent.length, 0);

  const invalid = await s.call('PATCH', `/tasks/${task.id}`, { token: a, body: { title: '   ' } });
  assert.strictEqual(invalid.status, 400);
  assert.strictEqual(invalid.body.error, 'Введите название задачи');

  assert.strictEqual((await s.call('DELETE', `/tasks/${task.id}`, { token: a })).status, 204);
  assert.strictEqual((await s.call('DELETE', `/tasks/${task.id}`, { token: a })).status, 404);
  assert.strictEqual((await s.call('GET', '/tasks', { token: a })).body.tasks.length, 0);
});

test('подписки на уведомления и защита входа', async (t) => {
  const s = await setup();
  t.after(s.close);
  const b = (await s.call('POST', '/login', { body: { role: 'boss', pin: '2222' } })).body.token;
  const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } };

  assert.strictEqual((await s.call('POST', '/push/subscribe', { token: b, body: { subscription: sub } })).status, 204);
  assert.strictEqual((await s.call('POST', '/push/subscribe', { token: b, body: { subscription: sub } })).status, 204);
  assert.strictEqual(s.store.data.subscriptions.boss.length, 1);
  assert.strictEqual((await s.call('POST', '/push/subscribe', { token: b, body: { subscription: {} } })).status, 400);
  await s.call('POST', '/push/unsubscribe', { token: b, body: { endpoint: sub.endpoint } });
  assert.strictEqual(s.store.data.subscriptions.boss.length, 0);

  for (let i = 0; i < 3; i++) await s.call('POST', '/login', { body: { role: 'boss', pin: '0' } });
  const blocked = await s.call('POST', '/login', { body: { role: 'boss', pin: '2222' } });
  assert.strictEqual(blocked.status, 429);
});
