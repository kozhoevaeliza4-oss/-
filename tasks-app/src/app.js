const path = require('path');
const express = require('express');
const { validateInput, createTask, dueAtFor, describeWhen, publicTask } = require('./tasks');
const { dateIn } = require('./time');

// Собирает HTTP-приложение. Все внешние зависимости (хранилище, отправка
// уведомлений, часы) передаются снаружи — так их легко подменить в тестах.
function createApp({ store, auth, limiter, send, clock = Date.now, timezone, reminderMinutes, vapidPublicKey }) {
  const app = express();
  const streams = new Set();

  app.use(express.json({ limit: '20kb' }));

  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      setHeaders(res, file) {
        // Service worker и страница всегда свежие, иначе обновления не доедут.
        if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  function broadcast() {
    for (const res of streams) res.write('event: tasks\ndata: {}\n\n');
  }

  function notify(role, payload) {
    Promise.resolve(send(role, payload)).catch((err) => console.error('push error:', err.message));
  }

  function tokenFrom(req) {
    const header = req.get('authorization') || '';
    if (header.startsWith('Bearer ')) return header.slice(7);
    return typeof req.query.token === 'string' ? req.query.token : '';
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      const role = auth.verify(tokenFrom(req));
      if (!role) return res.status(401).json({ error: 'Нужно войти заново' });
      if (roles.length && !roles.includes(role)) return res.status(403).json({ error: 'Недостаточно прав' });
      req.role = role;
      next();
    };
  }

  function findTask(req, res) {
    const task = store.data.tasks.find((t) => t.id === req.params.id);
    if (!task) res.status(404).json({ error: 'Задача не найдена' });
    return task;
  }

  // Если до задачи уже меньше, чем окно напоминания, отдельное напоминание
  // не шлём — только что пришло уведомление о самой задаче.
  function markReminderIfClose(task, now) {
    task.remindedAt = task.dueAt != null && task.dueAt - now <= reminderMinutes * 60_000 ? now : null;
  }

  // Для проверки хостингом и внешнего «будильника», который не даёт
  // бесплатному серверу уснуть (иначе напоминания не придут вовремя).
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.post('/api/login', (req, res) => {
    const ip = req.ip;
    if (limiter.blocked(ip)) return res.status(429).json({ error: 'Слишком много попыток. Подождите минуту' });
    const { role, pin } = req.body || {};
    if (!auth.checkPin(role, pin)) {
      limiter.fail(ip);
      return res.status(401).json({ error: 'Неверный PIN-код' });
    }
    limiter.reset(ip);
    res.json({ token: auth.issue(role), role });
  });

  app.get('/api/me', requireRole(), (req, res) => {
    res.json({ role: req.role, timezone, reminderMinutes, vapidPublicKey, now: clock() });
  });

  app.get('/api/tasks', requireRole(), (req, res) => {
    const now = clock();
    res.json({ now, today: dateIn(timezone, now), tasks: store.data.tasks.map((t) => publicTask(t, now, timezone)) });
  });

  app.post('/api/tasks', requireRole('assistant'), (req, res) => {
    const { errors, value } = validateInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const now = clock();
    const task = createTask(value, now, timezone);
    markReminderIfClose(task, now);
    store.data.tasks.push(task);
    store.save();
    notify('boss', {
      title: 'Новая задача',
      body: `${task.title} — ${describeWhen(task, now, timezone)}`,
      tag: `task-${task.id}`,
      taskId: task.id,
    });
    broadcast();
    res.status(201).json(publicTask(task, now, timezone));
  });

  app.patch('/api/tasks/:id', requireRole('assistant'), (req, res) => {
    const task = findTask(req, res);
    if (!task) return;
    const { errors, value } = validateInput(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const now = clock();
    const whenChanged = ['date', 'time'].some((k) => k in value && value[k] !== task[k]);
    const titleChanged = 'title' in value && value.title !== task.title;
    Object.assign(task, value, { updatedAt: now });
    if (whenChanged) {
      task.dueAt = dueAtFor(task, timezone);
      markReminderIfClose(task, now);
    }
    store.save();
    if ((whenChanged || titleChanged) && !task.done) {
      notify('boss', {
        title: 'Задача изменена',
        body: `${task.title} — ${describeWhen(task, now, timezone)}`,
        tag: `task-${task.id}`,
        taskId: task.id,
      });
    }
    broadcast();
    res.json(publicTask(task, now, timezone));
  });

  // Отметить выполненной (или вернуть в работу, если нажали по ошибке).
  app.post('/api/tasks/:id/done', requireRole(), (req, res) => {
    const task = findTask(req, res);
    if (!task) return;
    const done = req.body?.done !== false;
    const now = clock();
    const changed = task.done !== done;
    task.done = done;
    task.doneAt = done ? task.doneAt || now : null;
    task.updatedAt = now;
    store.save();
    if (changed && done && req.role === 'boss') {
      notify('assistant', { title: 'Выполнено', body: task.title, tag: `done-${task.id}`, taskId: task.id });
    }
    broadcast();
    res.json(publicTask(task, now, timezone));
  });

  app.delete('/api/tasks/:id', requireRole('assistant'), (req, res) => {
    const task = findTask(req, res);
    if (!task) return;
    store.data.tasks = store.data.tasks.filter((t) => t !== task);
    store.save();
    broadcast();
    res.status(204).end();
  });

  app.post('/api/push/subscribe', requireRole(), (req, res) => {
    const sub = req.body?.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ error: 'Неверная подписка' });
    }
    // Одно устройство может числиться только за одной ролью.
    for (const role of Object.keys(store.data.subscriptions)) {
      store.data.subscriptions[role] = store.data.subscriptions[role].filter((s) => s.endpoint !== sub.endpoint);
    }
    store.data.subscriptions[req.role].push({ endpoint: sub.endpoint, keys: sub.keys });
    store.save();
    res.status(204).end();
  });

  app.post('/api/push/unsubscribe', requireRole(), (req, res) => {
    const endpoint = req.body?.endpoint;
    store.data.subscriptions[req.role] = store.data.subscriptions[req.role].filter((s) => s.endpoint !== endpoint);
    store.save();
    res.status(204).end();
  });

  // Живая синхронизация: второй телефон узнаёт об изменениях мгновенно.
  app.get('/api/events', requireRole(), (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    streams.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      streams.delete(res);
    });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));

  app.closeStreams = () => {
    for (const res of streams) res.end();
    streams.clear();
  };

  return app;
}

module.exports = { createApp };
