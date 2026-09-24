const { describeWhen } = require('./tasks');

function minutesWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'минуту';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'минуты';
  return 'минут';
}

// Задачи, по которым пора напомнить: не выполнены, есть время,
// до начала осталось не больше reminderMinutes и напоминания ещё не было.
function dueReminders(tasks, now, reminderMinutes) {
  const windowMs = reminderMinutes * 60_000;
  return tasks.filter(
    (t) => !t.done && t.dueAt != null && !t.remindedAt && t.dueAt > now && t.dueAt - now <= windowMs,
  );
}

function reminderPayload(task, now, timezone) {
  const mins = Math.max(1, Math.round((task.dueAt - now) / 60_000));
  return {
    title: `Через ${mins} ${minutesWord(mins)}`,
    body: `${task.title} — ${describeWhen(task, now, timezone)}`,
    tag: `task-${task.id}`,
    taskId: task.id,
  };
}

function runReminders({ store, send, now, timezone, reminderMinutes }) {
  const due = dueReminders(store.data.tasks, now, reminderMinutes);
  if (!due.length) return [];
  for (const task of due) {
    task.remindedAt = now;
    send('boss', reminderPayload(task, now, timezone));
  }
  store.save();
  return due;
}

module.exports = { dueReminders, reminderPayload, runReminders, minutesWord };
