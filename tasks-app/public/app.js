'use strict';

/* ============================================================
   Задачи руководителя — клиент (без фреймворков).
   Ассистент: список всех задач + форма добавления/редактирования.
   Руководитель: задачи на сегодня + кнопка «Выполнить».
   ============================================================ */

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
let $sheet = null;

const LS_TOKEN = 'bt.token';
const LS_CACHE = 'bt.cache';

const state = {
  token: lsGet(LS_TOKEN),
  role: null,
  me: null,
  tasks: [],
  serverOffset: 0,
  loginRole: null,
  loginError: '',
  offline: false,
  push: 'unknown',
  pending: new Set(),
};

/* ---------- Утилиты ---------- */

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* приватный режим — просто не кэшируем */ }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function icon(name, cls = 'i') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function now() {
  return Date.now() + state.serverOffset;
}

function tz() {
  return state.me?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function dateIn(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
}

function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dateObj(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

// «четверг, 24 сентября»
function longDate(date) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateObj(date));
}

// «сегодня» / «завтра» / «пт, 26 сентября»
function shortDate(date, today) {
  if (date === today) return 'Сегодня';
  if (date === addDays(today, 1)) return 'Завтра';
  if (date === addDays(today, -1)) return 'Вчера';
  const s = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateObj(date));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Та же логика, что на сервере: просрочено = время прошло, а задача не выполнена.
function statusOf(task, ts = now()) {
  if (task.done) return 'done';
  if (task.dueAt != null) return ts > task.dueAt ? 'overdue' : 'pending';
  return task.date < dateIn(ts) ? 'overdue' : 'pending';
}

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
function byTime(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (!!a.time !== !!b.time) return a.time ? -1 : 1;
  if (a.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt;
}

let toastTimer;
function toast(text) {
  $toast.textContent = text;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, 2600);
}

function vibrate() {
  if (navigator.vibrate) navigator.vibrate(15);
}

/* ---------- API ---------- */

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`api/${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && state.token) {
    logout(false);
    throw new Error('Нужно войти заново');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

async function loadTasks() {
  if (!state.token) return;
  try {
    const data = await api('tasks');
    state.serverOffset = data.now - Date.now();
    state.tasks = data.tasks;
    state.offline = false;
    lsSet(LS_CACHE, JSON.stringify({ role: state.role, tasks: data.tasks }));
  } catch (err) {
    if (state.token) state.offline = true;
  }
  render();
}

/* ---------- Вход / выход ---------- */

async function start() {
  if (!state.token) return render();
  state.role = state.token.split('.')[0];
  // Сразу показываем последние известные задачи, пока грузятся свежие.
  try {
    const cache = JSON.parse(lsGet(LS_CACHE) || 'null');
    if (cache && cache.role === state.role) state.tasks = cache.tasks;
  } catch { /* кэш испорчен — не страшно */ }
  render();
  try {
    state.me = await api('me');
    state.role = state.me.role;
  } catch {
    if (!state.token) return;
    state.offline = true;
  }
  await loadTasks();
  connectEvents();
  refreshPushState();
}

async function login(pin) {
  state.loginError = '';
  try {
    const { token } = await api('login', { method: 'POST', body: { role: state.loginRole, pin } });
    state.token = token;
    lsSet(LS_TOKEN, token);
    state.loginRole = null;
    await start();
  } catch (err) {
    state.loginError = err.message;
    render();
    const input = $app.querySelector('.pin-input');
    if (input) { input.value = ''; input.focus(); }
  }
}

async function logout(tellServer = true) {
  if (tellServer) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await api('push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
      }
    } catch { /* выходим в любом случае */ }
  }
  events?.close();
  events = null;
  state.token = null;
  state.role = null;
  state.me = null;
  state.tasks = [];
  lsSet(LS_TOKEN, null);
  lsSet(LS_CACHE, null);
  closeSheet();
  render();
}

/* ---------- Синхронизация ---------- */

let events = null;
function connectEvents() {
  if (!state.token || events || !('EventSource' in window)) return;
  events = new EventSource(`api/events?token=${encodeURIComponent(state.token)}`);
  events.addEventListener('tasks', loadTasks);
  events.addEventListener('open', () => {
    if (state.offline) loadTasks();
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadTasks();
});
window.addEventListener('online', loadTasks);
// Перерисовка раз в 30 с: статусы «Просрочено» и смена дня в полночь.
setInterval(render, 30_000);
// Запасной опрос на случай, если живое соединение оборвалось незаметно.
setInterval(loadTasks, 120_000);

/* ---------- Уведомления ---------- */

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function urlB64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function refreshPushState() {
  let next;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    next = isIOS && !isStandalone ? 'ios-install' : 'unsupported';
  } else if (Notification.permission === 'denied') {
    next = 'denied';
  } else {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      next = 'on';
      // Подтверждаем подписку на сервере — вдруг её там удалили.
      api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } }).catch(() => {});
    } else {
      next = 'off';
    }
  }
  if (next !== state.push) {
    state.push = next;
    render();
  }
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      state.push = perm === 'denied' ? 'denied' : 'off';
      render();
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(state.me.vapidPublicKey),
    }));
    await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    state.push = 'on';
    toast('Уведомления включены');
  } catch (err) {
    toast('Не удалось включить уведомления');
    console.error(err);
  }
  render();
}

function pushBanner() {
  const texts = {
    off: state.role === 'boss'
      ? 'Включите уведомления, чтобы не пропустить новые задачи и напоминания'
      : 'Включите уведомления, чтобы знать, когда задача выполнена',
    'ios-install': 'Чтобы получать уведомления на iPhone, добавьте приложение на экран «Домой»: «Поделиться» → «На экран „Домой“»',
    denied: 'Уведомления запрещены. Разрешите их в настройках телефона для этого приложения',
  };
  const text = texts[state.push];
  if (!text) return '';
  const button = state.push === 'off' ? '<button data-action="enable-push">Включить</button>' : '';
  return `<div class="banner">${icon('bell')}<p>${esc(text)}</p>${button}</div>`;
}

/* ---------- Отрисовка ---------- */

function render() {
  if (!state.token) return renderLogin();
  if (state.role === 'boss') return renderBoss();
  return renderAssistant();
}

function renderLogin() {
  if (!state.loginRole) {
    $app.innerHTML = `
      <section class="screen login">
        <div class="logo">${icon('check')}</div>
        <h1>Задачи</h1>
        <p class="lead">Кто вы?</p>
        <div class="roles">
          <button class="role" data-action="pick-role" data-role="boss">
            <span class="ic">${icon('briefcase')}</span>
            <span>Руководитель<small>Смотрю и выполняю задачи</small></span>
          </button>
          <button class="role" data-action="pick-role" data-role="assistant">
            <span class="ic">${icon('user')}</span>
            <span>Ассистент<small>Добавляю задачи</small></span>
          </button>
        </div>
      </section>`;
    return;
  }
  const name = state.loginRole === 'boss' ? 'Руководитель' : 'Ассистент';
  $app.innerHTML = `
    <section class="screen login">
      <button class="back" data-action="pick-role" data-role="">${icon('back')}Назад</button>
      <h1>${name}</h1>
      <p class="lead">Введите PIN-код</p>
      <form class="pin-form" data-form="login">
        <input class="pin-input" name="pin" type="password" inputmode="numeric" autocomplete="current-password"
               maxlength="12" required autofocus aria-label="PIN-код">
        <p class="error" role="alert">${esc(state.loginError)}</p>
        <button class="primary" type="submit">Войти</button>
      </form>
    </section>`;
  $app.querySelector('.pin-input').focus();
}

function badges(task, status, { showDate = false, today } = {}) {
  const out = [];
  if (showDate) out.push(`<span class="badge">${esc(shortDate(task.date, today))}</span>`);
  if (status === 'overdue') out.push('<span class="badge overdue">Просрочено</span>');
  if (status === 'done') out.push(`<span class="badge done">${icon('check')}Выполнено</span>`);
  if (task.priority === 'high' && status !== 'done') out.push('<span class="badge high">Важно</span>');
  if (task.priority === 'low' && status !== 'done') out.push('<span class="badge low">Не срочно</span>');
  return out.join('');
}

function timeCell(task) {
  return task.time
    ? `<div class="time">${esc(task.time)}</div>`
    : '<div class="time none">—</div>';
}

function bossCard(task, today) {
  const status = statusOf(task);
  const done = status === 'done';
  const busy = state.pending.has(task.id);
  return `
    <article class="card ${status} ${task.priority}">
      ${timeCell(task)}
      <div class="body">
        <div class="title">${esc(task.title)}</div>
        ${task.description ? `<div class="desc">${esc(task.description)}</div>` : ''}
        <div class="meta">${badges(task, status, { showDate: task.date !== today, today })}</div>
      </div>
      <button class="do-btn ${done ? 'is-done' : ''}" data-action="toggle-done" data-id="${task.id}" ${busy ? 'disabled' : ''}
              aria-label="${done ? 'Вернуть в работу' : 'Выполнить'}: ${esc(task.title)}">
        <span class="ring">${icon('check')}</span>
        <span>${done ? 'Выполнено' : 'Выполнить'}</span>
      </button>
    </article>`;
}

function section(title, items, cls = '') {
  if (!items.length) return '';
  return `${title ? `<h2 class="section-title ${cls}">${esc(title)}</h2>` : ''}<div class="list">${items.join('')}</div>`;
}

function renderBoss() {
  const today = dateIn(now());
  const todays = state.tasks.filter((t) => t.date === today).sort(byTime);
  const earlier = state.tasks.filter((t) => t.date < today && !t.done).sort(byTime);
  const active = todays.filter((t) => !t.done);
  const timed = active.filter((t) => t.time);
  const untimed = active.filter((t) => !t.time);
  const done = todays.filter((t) => t.done).sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));
  const left = active.length + earlier.length;
  // Чтобы руководитель видел и ближайшие дни, а не только сегодня.
  const horizon = addDays(today, 14);
  const upcoming = state.tasks.filter((t) => t.date > today && t.date <= horizon && !t.done).sort(byTime);

  let content = '';
  if (!todays.length && !earlier.length) {
    content = `
      <div class="empty${upcoming.length ? ' compact' : ''}">
        <div class="big">${icon('sun')}</div>
        <h2>На сегодня задач нет</h2>
        <p>${upcoming.length ? 'Ниже — задачи на ближайшие дни' : 'Когда ассистент добавит задачу, придёт уведомление'}</p>
      </div>`;
  } else {
    content += section('Не выполнено ранее', earlier.map((t) => bossCard(t, today)), 'danger');
    content += section(earlier.length ? 'Сегодня' : '', timed.map((t) => bossCard(t, today)));
    content += section('Без времени', untimed.map((t) => bossCard(t, today)));
    if (!left) {
      content += `
        <div class="empty" style="padding:36px 24px 8px">
          <div class="big">${icon('check')}</div>
          <h2>Всё выполнено</h2>
          <p>На сегодня задач больше нет</p>
        </div>`;
    }
    content += section('Выполнено', done.map((t) => bossCard(t, today)));
  }
  content += section('Предстоящие', upcoming.map((t) => bossCard(t, today)));

  $app.innerHTML = `
    <section class="screen">
      <header class="top">
        <div>
          <h1>Сегодня</h1>
          <div class="date">${esc(longDate(today))}</div>
        </div>
        <button class="icon-btn" data-action="menu" aria-label="Меню">${icon('more')}</button>
      </header>
      ${state.offline ? '<p class="offline">Нет связи — показаны последние сохранённые задачи</p>' : ''}
      ${pushBanner()}
      ${content}
    </section>
    <div class="bottom">
      <div class="counter" aria-label="Итог дня">
        <div class="ok"><b>${done.length}</b><span>Выполнено</span></div>
        <div><b>${left}</b><span>Осталось</span></div>
      </div>
    </div>`;
}

function assistantCard(task, today, { showDate = false } = {}) {
  const status = statusOf(task);
  return `
    <button class="card ${status} ${task.priority}" data-action="edit" data-id="${task.id}">
      ${timeCell(task)}
      <div class="body">
        <div class="title">${esc(task.title)}</div>
        ${task.description ? `<div class="desc">${esc(task.description)}</div>` : ''}
        <div class="meta">${badges(task, status, { showDate, today })}</div>
      </div>
    </button>`;
}

function renderAssistant() {
  const today = dateIn(now());
  const sorted = [...state.tasks].sort(byTime);
  const overdue = sorted.filter((t) => statusOf(t) === 'overdue');
  const upcoming = sorted.filter((t) => statusOf(t) === 'pending');
  const weekAgo = addDays(today, -7);
  const done = state.tasks
    .filter((t) => t.done && (t.date >= weekAgo || (t.doneAt && t.doneAt > now() - 7 * 864e5)))
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
    .slice(0, 30);

  const byDate = new Map();
  for (const t of upcoming) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }

  let content = section('Просрочено', overdue.map((t) => assistantCard(t, today, { showDate: t.date !== today })), 'danger');
  for (const [date, list] of byDate) {
    content += section(shortDate(date, today), list.map((t) => assistantCard(t, today)));
  }
  content += section('Выполнено', done.map((t) => assistantCard(t, today, { showDate: true })));

  if (!overdue.length && !upcoming.length && !done.length) {
    content = `
      <div class="empty">
        <div class="big" style="background:var(--accent-soft);color:var(--accent)">${icon('plus')}</div>
        <h2>Задач пока нет</h2>
        <p>Нажмите «Новая задача» — руководитель сразу получит уведомление</p>
      </div>`;
  } else if (!overdue.length && !upcoming.length) {
    content = `<p class="muted" style="margin:0 6px">Все задачи выполнены.</p>${content}`;
  }

  $app.innerHTML = `
    <section class="screen">
      <header class="top">
        <div>
          <h1>Задачи</h1>
          <div class="date">${esc(longDate(today))}</div>
        </div>
        <button class="icon-btn" data-action="menu" aria-label="Меню">${icon('more')}</button>
      </header>
      ${state.offline ? '<p class="offline">Нет связи — показаны последние сохранённые задачи</p>' : ''}
      ${pushBanner()}
      ${content}
    </section>
    <div class="bottom">
      <button class="primary" data-action="new">${icon('plus')}Новая задача</button>
    </div>`;
}

/* ---------- Нижний лист ---------- */

function openSheet(html) {
  closeSheet();
  $sheet = document.createElement('div');
  $sheet.className = 'sheet-backdrop';
  $sheet.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  $sheet.addEventListener('click', (e) => {
    if (e.target === $sheet) closeSheet();
  });
  document.body.appendChild($sheet);
  document.body.style.overflow = 'hidden';
  return $sheet;
}

function closeSheet() {
  if (!$sheet) return;
  $sheet.remove();
  $sheet = null;
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

function openMenu() {
  const who = state.role === 'boss' ? 'Руководитель' : 'Ассистент';
  const pushLine = state.push === 'on'
    ? '<button disabled>Уведомления включены ✓</button>'
    : state.push === 'off' ? '<button data-action="enable-push">Включить уведомления</button>' : '';
  const sheet = openSheet(`
    <div class="sheet-head"><h2>Меню</h2><button class="icon-btn" data-action="close" aria-label="Закрыть">${icon('close')}</button></div>
    <p class="muted who" style="margin:0 4px 12px">Вы вошли как: <b>${who}</b></p>
    <div class="menu">
      ${pushLine}
      <button data-action="logout" style="color:var(--danger)">Выйти</button>
    </div>`);
  sheet.addEventListener('click', onClick);
}

function openTaskForm(task) {
  const today = dateIn(now());
  const draft = task
    ? { title: task.title, description: task.description, date: task.date, time: task.time || '', priority: task.priority }
    : { title: '', description: '', date: today, time: '', priority: 'normal' };
  const tomorrow = addDays(today, 1);
  let showOtherDate = draft.date !== today && draft.date !== tomorrow;

  const sheet = openSheet('<form data-form="task" novalidate></form>');
  const form = sheet.querySelector('form');

  function paint() {
    const dateChip = (label, value) =>
      `<button type="button" class="chip" data-date="${value}" aria-pressed="${!showOtherDate && draft.date === value}">${label}</button>`;
    const prioChip = (label, value) =>
      `<button type="button" class="chip p-${value}" data-priority="${value}" aria-pressed="${draft.priority === value}">${label}</button>`;
    form.innerHTML = `
      <div class="sheet-head">
        <h2>${task ? 'Задача' : 'Новая задача'}</h2>
        <button type="button" class="icon-btn" data-action="close" aria-label="Закрыть">${icon('close')}</button>
      </div>
      <div class="field">
        <label for="f-title">Что сделать</label>
        <input id="f-title" class="input title-input" name="title" maxlength="120" required
               placeholder="Позвонить подрядчику" value="${esc(draft.title)}" autocomplete="off" enterkeyhint="next">
      </div>
      <div class="field">
        <label for="f-desc">Описание <span style="font-weight:400">— необязательно</span></label>
        <textarea id="f-desc" class="input" name="description" maxlength="500" rows="2"
                  placeholder="Обсудить сроки строительства">${esc(draft.description)}</textarea>
      </div>
      <div class="field">
        <span class="label">Дата</span>
        <div class="chips">
          ${dateChip('Сегодня', today)}
          ${dateChip('Завтра', tomorrow)}
          <button type="button" class="chip" data-date="other" aria-pressed="${showOtherDate}">Другая</button>
        </div>
        ${showOtherDate ? `<div class="row"><input class="input" type="date" name="date" value="${esc(draft.date)}" min="${today}" aria-label="Дата"></div>` : ''}
      </div>
      <div class="field">
        <span class="label">Время</span>
        <div class="row" style="margin-top:0">
          <input class="input" type="time" name="time" value="${esc(draft.time)}" aria-label="Время">
          <button type="button" class="chip" data-action="no-time" style="flex:none" aria-pressed="${!draft.time}">Без времени</button>
        </div>
      </div>
      <div class="field">
        <span class="label">Приоритет</span>
        <div class="chips">
          ${prioChip('Не срочно', 'low')}
          ${prioChip('Обычный', 'normal')}
          ${prioChip('Важно', 'high')}
        </div>
      </div>
      <p class="error" role="alert"></p>
      <button class="primary" type="submit">${task ? 'Сохранить' : 'Добавить'}</button>
      ${task ? '<button type="button" class="danger-link" data-action="delete">Удалить задачу</button>' : ''}`;
  }

  form.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (name in draft) draft[name] = value;
    if (name === 'time') {
      form.querySelector('[data-action="no-time"]').setAttribute('aria-pressed', String(!value));
    }
  });

  form.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.action === 'close') return closeSheet();
    if (btn.dataset.date) {
      if (btn.dataset.date === 'other') {
        showOtherDate = true;
        if (draft.date === today || draft.date === tomorrow) draft.date = addDays(today, 2);
      } else {
        showOtherDate = false;
        draft.date = btn.dataset.date;
      }
      paint();
    } else if (btn.dataset.priority) {
      draft.priority = btn.dataset.priority;
      paint();
    } else if (btn.dataset.action === 'no-time') {
      draft.time = '';
      paint();
    } else if (btn.dataset.action === 'delete') {
      if (!confirm(`Удалить задачу «${task.title}»?`)) return;
      try {
        await api(`tasks/${task.id}`, { method: 'DELETE' });
        state.tasks = state.tasks.filter((t) => t.id !== task.id);
        closeSheet();
        render();
        toast('Задача удалена');
      } catch (err) {
        form.querySelector('.error').textContent = err.message;
      }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = form.querySelector('.error');
    const submit = form.querySelector('[type="submit"]');
    draft.title = draft.title.trim();
    if (!draft.title) {
      error.textContent = 'Напишите, что нужно сделать';
      form.querySelector('[name="title"]').focus();
      return;
    }
    if (!draft.date) {
      error.textContent = 'Укажите дату';
      return;
    }
    submit.disabled = true;
    const body = { ...draft, time: draft.time || null };
    try {
      const saved = task
        ? await api(`tasks/${task.id}`, { method: 'PATCH', body })
        : await api('tasks', { method: 'POST', body });
      state.tasks = [...state.tasks.filter((t) => t.id !== saved.id), saved];
      closeSheet();
      render();
      vibrate();
      toast(task ? 'Сохранено' : 'Задача добавлена — руководитель получит уведомление');
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
    }
  });

  paint();
  if (!task) setTimeout(() => form.querySelector('[name="title"]')?.focus(), 250);
}

/* ---------- Действия ---------- */

async function toggleDone(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || state.pending.has(id)) return;
  const done = !task.done;
  const prev = { done: task.done, doneAt: task.doneAt };
  // Оптимистично: отмечаем сразу, откатываем, если сервер не ответил.
  Object.assign(task, { done, doneAt: done ? now() : null });
  state.pending.add(id);
  if (done) vibrate();
  render();
  try {
    const saved = await api(`tasks/${id}/done`, { method: 'POST', body: { done } });
    Object.assign(task, saved);
  } catch (err) {
    Object.assign(task, prev);
    toast('Не удалось отметить. Проверьте связь');
  } finally {
    state.pending.delete(id);
    render();
  }
}

function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  switch (action) {
    case 'pick-role':
      state.loginRole = btn.dataset.role || null;
      state.loginError = '';
      render();
      break;
    case 'toggle-done': toggleDone(id); break;
    case 'new': openTaskForm(null); break;
    case 'edit': {
      const task = state.tasks.find((t) => t.id === id);
      if (task) openTaskForm(task);
      break;
    }
    case 'menu': openMenu(); break;
    case 'close': closeSheet(); break;
    case 'enable-push': closeSheet(); enablePush(); break;
    case 'logout': logout(); break;
    default: break;
  }
}

$app.addEventListener('click', onClick);
$app.addEventListener('submit', (e) => {
  if (e.target.dataset.form !== 'login') return;
  e.preventDefault();
  const pin = e.target.elements.pin.value.trim();
  if (pin) login(pin);
});

/* ---------- Запуск ---------- */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW:', err));
  // Клик по уведомлению при открытом приложении — просто обновить данные.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'refresh') loadTasks();
  });
}

start();
