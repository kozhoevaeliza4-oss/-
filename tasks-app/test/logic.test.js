const test = require('node:test');
const assert = require('node:assert');
const { dateIn, zonedToUtc, addDays, humanDate } = require('../src/time');
const { validateInput, statusOf, createTask, describeWhen } = require('../src/tasks');
const { dueReminders, reminderPayload, runReminders, minutesWord } = require('../src/reminders');
const { createAuth, createLoginLimiter } = require('../src/auth');

const TZ = 'Asia/Bishkek'; // UTC+6
const at = (iso) => Date.parse(iso);

test('время: локальная дата и перевод в UTC с учётом пояса', () => {
  assert.strictEqual(dateIn(TZ, at('2026-09-24T19:00:00Z')), '2026-09-25');
  assert.strictEqual(zonedToUtc('2026-09-24', '15:00', TZ), at('2026-09-24T09:00:00Z'));
  // Пояс с переходом на летнее время
  assert.strictEqual(zonedToUtc('2026-07-01', '12:00', 'Europe/Berlin'), at('2026-07-01T10:00:00Z'));
  assert.strictEqual(zonedToUtc('2026-01-15', '12:00', 'Europe/Berlin'), at('2026-01-15T11:00:00Z'));
  assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(humanDate('2026-09-24', '2026-09-24'), 'сегодня');
  assert.strictEqual(humanDate('2026-09-25', '2026-09-24'), 'завтра');
  assert.strictEqual(humanDate('2026-10-03', '2026-09-24'), '3 октября');
});

test('валидация задачи', () => {
  const ok = validateInput({ title: '  Позвонить подрядчику ', date: '2026-09-24', time: '15:00' });
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.value.title, 'Позвонить подрядчику');
  assert.strictEqual(ok.value.priority, 'normal');
  assert.strictEqual(ok.value.description, '');

  assert.ok(validateInput({ title: '', date: '2026-09-24' }).errors.length);
  assert.ok(validateInput({ title: 'x', date: '2026-02-30' }).errors.length);
  assert.ok(validateInput({ title: 'x', date: '2026-09-24', time: '25:00' }).errors.length);
  assert.ok(validateInput({ title: 'x', date: '2026-09-24', priority: 'urgent' }).errors.length);
  assert.strictEqual(validateInput({ title: 'x', date: '2026-09-24', time: '' }).value.time, null);

  const partial = validateInput({ time: '16:30' }, { partial: true });
  assert.deepStrictEqual(partial, { errors: [], value: { time: '16:30' } });
});

test('статус: выполнено / просрочено / в работе', () => {
  const now = at('2026-09-24T08:00:00Z'); // 14:00 в Бишкеке
  const timed = createTask({ title: 'a', description: '', date: '2026-09-24', time: '15:00', priority: 'normal' }, now, TZ);
  assert.strictEqual(statusOf(timed, now, TZ), 'pending');
  assert.strictEqual(statusOf(timed, at('2026-09-24T09:01:00Z'), TZ), 'overdue');
  assert.strictEqual(statusOf({ ...timed, done: true }, at('2026-09-24T10:00:00Z'), TZ), 'done');

  const untimed = createTask({ title: 'b', description: '', date: '2026-09-24', time: null, priority: 'normal' }, now, TZ);
  assert.strictEqual(untimed.dueAt, null);
  assert.strictEqual(statusOf(untimed, at('2026-09-24T17:59:00Z'), TZ), 'pending'); // 23:59
  assert.strictEqual(statusOf(untimed, at('2026-09-24T18:01:00Z'), TZ), 'overdue'); // следующий день

  assert.strictEqual(describeWhen(timed, now, TZ), 'сегодня в 15:00');
  assert.strictEqual(describeWhen(untimed, now, TZ), 'сегодня');
});

test('напоминания: за 30 минут и только один раз', () => {
  const created = at('2026-09-24T06:00:00Z');
  const task = createTask({ title: 'Позвонить подрядчику', description: '', date: '2026-09-24', time: '15:00', priority: 'normal' }, created, TZ);
  const store = { data: { tasks: [task] }, save() {} };
  const sent = [];
  const send = (role, p) => sent.push([role, p]);
  const run = (iso) => runReminders({ store, send, now: at(iso), timezone: TZ, reminderMinutes: 30 });

  assert.strictEqual(run('2026-09-24T08:29:00Z').length, 0); // 14:29 — рано
  assert.strictEqual(run('2026-09-24T08:30:00Z').length, 1); // 14:30
  assert.strictEqual(run('2026-09-24T08:31:00Z').length, 0); // повторно не шлём
  assert.deepStrictEqual(sent, [['boss', {
    title: 'Через 30 минут',
    body: 'Позвонить подрядчику — сегодня в 15:00',
    tag: `task-${task.id}`,
    taskId: task.id,
  }]]);

  const done = { ...task, remindedAt: null, done: true };
  assert.strictEqual(dueReminders([done], at('2026-09-24T08:40:00Z'), 30).length, 0);
  const past = { ...task, remindedAt: null };
  assert.strictEqual(dueReminders([past], at('2026-09-24T09:10:00Z'), 30).length, 0);

  assert.strictEqual(reminderPayload(task, at('2026-09-24T08:59:00Z'), TZ).title, 'Через 1 минуту');
  assert.deepStrictEqual([2, 5, 11, 21, 22, 25].map(minutesWord), ['минуты', 'минут', 'минут', 'минуту', 'минуты', 'минут']);
});

test('авторизация: PIN, токены, защита от перебора', () => {
  const auth = createAuth({ secret: 's', pins: { assistant: '1111', boss: '2222' } });
  assert.ok(auth.checkPin('boss', '2222'));
  assert.ok(!auth.checkPin('boss', '1111'));
  assert.ok(!auth.checkPin('admin', '2222'));
  const token = auth.issue('boss');
  assert.strictEqual(auth.verify(token), 'boss');
  assert.strictEqual(auth.verify(token.replace('boss.', 'assistant.')), null);
  assert.strictEqual(auth.verify('garbage'), null);

  // Смена PIN делает старые токены недействительными.
  const auth2 = createAuth({ secret: 's', pins: { assistant: '1111', boss: '9999' } });
  assert.strictEqual(auth2.verify(token), null);

  const limiter = createLoginLimiter({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) limiter.fail('ip', 0);
  assert.ok(limiter.blocked('ip', 500));
  assert.ok(!limiter.blocked('ip', 1500));
});
