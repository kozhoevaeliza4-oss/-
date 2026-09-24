const crypto = require('crypto');
const { dateIn, zonedToUtc, humanDate } = require('./time');

const PRIORITIES = ['low', 'normal', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Проверяет и нормализует поля задачи от ассистента.
// partial=true — для редактирования, когда приходят только изменённые поля.
function validateInput(body, { partial = false } = {}) {
  const errors = [];
  const out = {};
  const has = (k) => body && Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('title')) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) errors.push('Введите название задачи');
    else if (title.length > 120) errors.push('Название слишком длинное (до 120 символов)');
    out.title = title;
  }
  if (!partial || has('description')) {
    const desc = typeof body?.description === 'string' ? body.description.trim() : '';
    if (desc.length > 500) errors.push('Описание слишком длинное (до 500 символов)');
    out.description = desc;
  }
  if (!partial || has('date')) {
    if (!isValidDate(body?.date)) errors.push('Укажите дату');
    out.date = body?.date;
  }
  if (!partial || has('time')) {
    const time = body?.time || null;
    if (time !== null && !TIME_RE.test(time)) errors.push('Неверный формат времени');
    out.time = time;
  }
  if (!partial || has('priority')) {
    const priority = body?.priority || 'normal';
    if (!PRIORITIES.includes(priority)) errors.push('Неверный приоритет');
    out.priority = priority;
  }
  return { errors, value: out };
}

// Короткий комментарий руководителя к задаче (результат, уточнение).
function validateComment(value) {
  if (value == null) return { value: '' };
  if (typeof value !== 'string') return { error: 'Неверный комментарий' };
  const comment = value.trim();
  if (comment.length > 300) return { error: 'Комментарий слишком длинный (до 300 символов)' };
  return { value: comment };
}

function dueAtFor(task, timezone) {
  return task.time ? zonedToUtc(task.date, task.time, timezone) : null;
}

// «Просрочено» вычисляется, а не хранится: так статус всегда актуален
// без фоновых задач, которые его переключают.
function statusOf(task, now, timezone) {
  if (task.done) return 'done';
  if (task.dueAt != null) return now > task.dueAt ? 'overdue' : 'pending';
  return task.date < dateIn(timezone, now) ? 'overdue' : 'pending';
}

function createTask(input, now, timezone) {
  const task = {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description,
    date: input.date,
    time: input.time,
    priority: input.priority,
    done: false,
    doneAt: null,
    createdAt: now,
    updatedAt: now,
    remindedAt: null,
    comment: '',
    commentAt: null,
  };
  task.dueAt = dueAtFor(task, timezone);
  return task;
}

// «Позвонить подрядчику — сегодня в 15:00»
function describeWhen(task, now, timezone) {
  const day = humanDate(task.date, dateIn(timezone, now));
  return task.time ? `${day} в ${task.time}` : day;
}

function publicTask(task, now, timezone) {
  const { remindedAt, ...rest } = task;
  return { ...rest, status: statusOf(task, now, timezone) };
}

module.exports = {
  PRIORITIES,
  validateInput,
  validateComment,
  dueAtFor,
  statusOf,
  createTask,
  describeWhen,
  publicTask,
};
