/** Форматирование значений для интерфейса. null всегда отображается как отсутствие данных, а не как 0. */
import Decimal from "decimal.js";

export const NO_DATA = "Нет данных";

type V = Decimal | string | number | null | undefined;

function toDec(v: V): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new Decimal(v as Decimal.Value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

const CURRENCY_SYMBOL: Record<string, string> = { KGS: "сом", USD: "$", EUR: "€", RUB: "₽", KZT: "₸" };

function group(d: Decimal, dp: number): string {
  const fixed = d.toFixed(dp);
  const neg = fixed.startsWith("-");
  const [int, frac] = (neg ? fixed.slice(1) : fixed).split(".");
  const intGrouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (neg ? "−" : "") + intGrouped + (frac ? "," + frac : "");
}

export function fmtMoney(v: V, currency = "KGS", empty = "—"): string {
  const d = toDec(v);
  if (d === null) return empty;
  return `${group(d, 2)} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

export function fmtNum(v: V, dp = 2, empty = "—"): string {
  const d = toDec(v);
  if (d === null) return empty;
  // убираем лишние нули у объёмов: 12,5000 → 12,5
  const s = group(d, dp);
  return s.includes(",") ? s.replace(/,?0+$/, "") : s;
}

export function fmtPct(v: V, empty = "—"): string {
  const d = toDec(v);
  if (d === null) return empty;
  return `${group(d, 1)} %`;
}

export function fmtDate(v: Date | string | null | undefined, empty = "—"): string {
  if (!v) return empty;
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return empty;
  return d.toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

export function fmtDateTime(v: Date | string | null | undefined, empty = "—"): string {
  if (!v) return empty;
  const d = typeof v === "string" ? new Date(v) : v;
  // Часовой пояс задаётся явно: иначе время зависит от настроек сервера (в контейнере — UTC)
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: process.env.APP_TIMEZONE || "Asia/Bishkek" });
}

/** Дата в формате YYYY-MM-DD для input[type=date] */
export function isoDate(v: Date | null | undefined): string {
  if (!v) return "";
  return v.toISOString().slice(0, 10);
}
