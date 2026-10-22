/**
 * Нормализация значений, извлечённых из документов. Исходное значение всегда сохраняется отдельно;
 * если нормализация потребовала исправлений, это отмечается и уверенность снижается.
 */
import { parseNumberCell } from "@/lib/import/tabular";

export interface NormalizedNumber {
  value: string | null;
  /** Были замены похожих символов (О→0, l→1 и т.п.) */
  corrected: boolean;
  ok: boolean;
}

// Похожие на цифры символы, встречающиеся при OCR (кириллица и латиница)
const DIGIT_LOOKALIKES: Record<string, string> = {
  O: "0", o: "0", О: "0", о: "0", D: "0",
  l: "1", I: "1", "|": "1", і: "1", І: "1", "!": "1",
  З: "3", з: "3",
  Б: "6", б: "6",
  S: "5", s: "5",
  B: "8", В: "8",
};

/**
 * Число из распознанного текста. Исправления похожих символов выполняются только если
 * токен в основном состоит из цифр (≥ 60 %), иначе значение не считается числом.
 */
export function normalizeNumber(raw: string | null | undefined): NormalizedNumber {
  if (raw === null || raw === undefined) return { value: null, corrected: false, ok: true };
  let s = String(raw).trim();
  if (s === "" || s === "-" || s === "—") return { value: null, corrected: false, ok: true };
  s = s.replace(/[  ]/g, " ").replace(/[‚]/g, ",").replace(/[–—−]/g, "-");
  const direct = parseNumberCell(s);
  if (direct.ok) return { value: direct.value, corrected: false, ok: true };
  const chars = s.replace(/[\s.,\-()]/g, "");
  const digits = (chars.match(/\d/g) ?? []).length;
  if (!chars.length || digits / chars.length < 0.6) return { value: null, corrected: false, ok: false };
  const fixed = s.replace(/[^\d\s.,\-()]/g, (ch) => DIGIT_LOOKALIKES[ch] ?? ch);
  const p = parseNumberCell(fixed);
  return p.ok ? { value: p.value, corrected: true, ok: true } : { value: null, corrected: false, ok: false };
}

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, мая: 5, май: 5, июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
  // кыргызские традиционные названия
  "үчтүн айы": 1, "бирдин айы": 2, жалган: 3, "чын куран": 4, бугу: 5, кулжа: 6, теке: 7, баш: 8, аяк: 9, тогуздун: 10, жетинин: 11, бештин: 12,
};

/** Дата из текста: 12.10.2026, 12/10/26, 2026-10-12, «12» октября 2026 г. Возвращает YYYY-MM-DD или null. */
export function parseDocDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/[ОO]/g, "0").replace(/[«»"“”]/g, " ");
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/.exec(t);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return valid(y, +m[2], +m[1]);
  }
  m = /\b(\d{1,2})\s+([а-яёүңө]+(?:\s+айы)?)\s+(\d{4})/i.exec(t);
  if (m) {
    const name = m[2].toLowerCase();
    const key = Object.keys(MONTHS).find((k) => name.startsWith(k));
    if (key) return valid(+m[3], MONTHS[key], +m[1]);
  }
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}

const LOOKALIKE_TO_LATIN: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y" };

/** Ключ для сравнения номеров документов: без пробелов и «№», единые дефисы, кириллица-двойники → латиница, О→0 в числовых частях. */
export function docNumberKey(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toUpperCase()
    .replace(/№|N°|NO\.?/g, "")
    .replace(/[\s_]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/[\\]/g, "/")
    .split("")
    .map((c) => LOOKALIKE_TO_LATIN[c] ?? c)
    .join("")
    .replace(/(?<=\d)O|O(?=\d)/g, "0");
}

/** Нестрогий ключ номера для поиска дубликатов: дополнительно игнорирует разделители (- / .). */
export function looseDocKey(s: string | null | undefined): string {
  return docNumberKey(s).replace(/[-/.]/g, "");
}

export function detectCurrency(text: string): string | null {
  // \b в JS не работает с кириллицей — границы слова задаём явно
  const w = (re: string) => new RegExp(`(?<![a-zа-яё])(?:${re})(?![a-zа-яё])`, "i").test(text);
  if (w("KGS|сом|сомов|сома|сомах")) return "KGS";
  if (w("USD|долл\\S*") || /\$/.test(text)) return "USD";
  if (w("EUR|евро") || /€/.test(text)) return "EUR";
  if (w("RUB|руб\\S*") || /₽/.test(text)) return "RUB";
  if (w("KZT|тенге")) return "KZT";
  return null;
}

// ───────────── Сумма прописью ─────────────

const UNITS: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50,
  шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300, четыреста: 400,
  пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};
const SCALES: [RegExp, number][] = [
  [/^миллиард/, 1e9],
  [/^миллион/, 1e6],
  [/^тысяч/, 1e3],
];

/**
 * Сумма прописью (русский): «Один миллион двести тысяч сом 50 тыйын» → "1200000.50".
 * Возвращает null, если текст не удалось однозначно разобрать.
 */
export function parseAmountInWords(text: string | null | undefined): string | null {
  if (!text) return null;
  const lower = text.toLowerCase().replace(/ё/g, "е");
  // целая часть — до названия валюты
  const m = /^(.*?)(сомов|сома|сом|рубл\S*|долл\S*|тенге)(?![а-я])(.*)$/.exec(lower);
  const intPart = (m ? m[1] : lower).replace(/[^а-я\s]/g, " ");
  const tokens = intPart.split(/\s+/).filter(Boolean);
  let total = 0;
  let chunk = 0;
  let any = false;
  for (const t of tokens) {
    if (t in UNITS) {
      chunk += UNITS[t];
      any = true;
      continue;
    }
    const sc = SCALES.find(([re]) => re.test(t));
    if (sc) {
      total += (chunk || 1) * sc[1];
      chunk = 0;
      any = true;
      continue;
    }
    if (any) return null; // неизвестное слово внутри числа
  }
  if (!any) return null;
  total += chunk;
  let frac = "00";
  if (m) {
    const k = /(\d{1,2})\s*(тыйын|коп)/.exec(m[3]);
    if (k) frac = k[1].padStart(2, "0");
  }
  return `${total}.${frac}`;
}
