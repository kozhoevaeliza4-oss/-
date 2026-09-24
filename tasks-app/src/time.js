// Работа с датами в часовом поясе приложения без внешних библиотек.

function partsIn(timezone, ts) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out = {};
  for (const p of fmt.formatToParts(new Date(ts))) out[p.type] = p.value;
  return out;
}

// 'YYYY-MM-DD' для момента ts в указанном поясе.
function dateIn(timezone, ts) {
  const p = partsIn(timezone, ts);
  return `${p.year}-${p.month}-${p.day}`;
}

function offsetMs(timezone, ts) {
  const p = partsIn(timezone, ts);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

// Локальные дата + время в поясе → абсолютный момент (мс).
function zonedToUtc(date, time, timezone) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - offsetMs(timezone, guess);
  // Второй проход — на случай перехода на летнее/зимнее время.
  ts = guess - offsetMs(timezone, ts);
  return ts;
}

function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

// «сегодня», «завтра» или «26 сентября».
function humanDate(date, today) {
  if (date === today) return 'сегодня';
  if (date === addDays(today, 1)) return 'завтра';
  if (date === addDays(today, -1)) return 'вчера';
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

module.exports = { dateIn, zonedToUtc, addDays, humanDate };
