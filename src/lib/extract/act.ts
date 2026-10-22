/**
 * Разбор акта выполненных работ из результатов OCR (слова с координатами).
 * Извлекаются реквизиты и строки таблицы. Каждое значение хранит исходный текст, нормализованное значение,
 * уверенность и расположение на странице. Нераспознанное остаётся пустым.
 */
import type { BBox, OcrPage, OcrWord } from "./ocrTypes";
import { joinWords, OcrLine, wordsToLines } from "./layout";
import { detectCurrency, normalizeNumber, parseAmountInWords, parseDocDate } from "./normalize";

export const LOW_CONFIDENCE = 70;

export type FieldStatus = "recognized" | "low_confidence" | "not_found" | "edited" | "confirmed";

export interface RecField {
  raw: string | null;
  value: string | null;
  confidence: number | null;
  bbox: BBox | null;
  status: FieldStatus;
  /** Значение нормализовано с исправлением похожих символов */
  corrected?: boolean;
}

export const ACT_FIELDS = {
  docType: "Тип документа",
  number: "Номер акта",
  date: "Дата составления",
  periodFrom: "Период с",
  periodTo: "Период по",
  customerName: "Заказчик",
  contractorName: "Подрядчик",
  contractorInn: "ИНН подрядчика",
  contractNumber: "Номер договора",
  contractDate: "Дата договора",
  projectName: "Стройка / проект",
  objectText: "Объект / корпус / этап",
  currency: "Валюта",
  subtotal: "Итого по строкам (по документу)",
  vatAmount: "НДС",
  total: "Всего по акту (по документу)",
  amountInWords: "Сумма прописью",
  signatories: "Подписанты (текст)",
} as const;

export type ActFieldKey = keyof typeof ACT_FIELDS;

export const LINE_COLUMNS = ["lineNo", "code", "name", "unit", "quantity", "unitPrice", "amount"] as const;
export type LineColumn = (typeof LINE_COLUMNS)[number];

export interface RecCell {
  raw: string | null;
  value: string | null;
  confidence: number | null;
  corrected?: boolean;
}

export interface RecLine {
  key: string;
  page: number;
  bbox: BBox | null;
  cells: Record<LineColumn, RecCell>;
  /** Раздел/подзаголовок, под которым находится строка */
  section: string | null;
  /** Строка добавлена или изменена пользователем */
  edited?: boolean;
}

export interface ActParseResult {
  fields: Record<ActFieldKey, RecField>;
  lines: RecLine[];
  warnings: string[];
  /** Документ содержит начисления (накладные, коэффициенты) между строками и итогом */
  hasCharges: boolean;
  fullText: string;
}

interface PLine extends OcrLine {
  page: number;
  pw: number;
  ph: number;
}

const emptyField = (): RecField => ({ raw: null, value: null, confidence: null, bbox: null, status: "not_found" });

function bboxOf(words: OcrWord[], page: number, pw: number, ph: number): BBox | null {
  if (!words.length || !pw || !ph) return null;
  const l = Math.min(...words.map((w) => w.left));
  const t = Math.min(...words.map((w) => w.top));
  const r = Math.max(...words.map((w) => w.left + w.width));
  const b = Math.max(...words.map((w) => w.top + w.height));
  return { page, x: l / pw, y: t / ph, w: (r - l) / pw, h: (b - t) / ph };
}

function conf(words: OcrWord[]): number | null {
  const c = words.map((w) => w.conf).filter((x) => x >= 0);
  return c.length ? Math.round(Math.min(...c)) : null;
}

function field(raw: string | null, value: string | null, words: OcrWord[], l: PLine | null, corrected = false): RecField {
  if (value === null || value === "") return { ...emptyField(), raw };
  const c = conf(words);
  return {
    raw,
    value,
    confidence: c,
    bbox: l ? bboxOf(words.length ? words : l.words, l.page, l.pw, l.ph) : null,
    status: corrected || (c !== null && c < LOW_CONFIDENCE) ? "low_confidence" : "recognized",
    corrected,
  };
}

/** Слова строки, покрывающие фрагмент текста (по позиции символов). */
function wordsForMatch(l: PLine, start: number, length: number): OcrWord[] {
  const out: OcrWord[] = [];
  let pos = 0;
  for (const w of l.words) {
    const idx = l.text.indexOf(w.text, pos);
    if (idx < 0) continue;
    pos = idx + w.text.length;
    if (idx + w.text.length > start && idx < start + length) out.push(w);
  }
  return out;
}

const DATE = String.raw`(?:«?\s*\d{1,2}\s*»?\s+[а-яёүөң]+(?:\s+айы)?\s+\d{4}\s*г?\.?|\d{1,2}[./]\d{1,2}[./]\d{2,4})`;

// ───────────── Реквизиты ─────────────

function extractHeader(lines: PLine[], fullText: string): Record<ActFieldKey, RecField> {
  const f = Object.fromEntries(Object.keys(ACT_FIELDS).map((k) => [k, emptyField()])) as Record<ActFieldKey, RecField>;
  const set = (k: ActFieldKey, v: RecField) => {
    if (f[k].status === "not_found" && v.value !== null) f[k] = v;
  };
  const tryRe = (k: ActFieldKey, re: RegExp, group = 1, norm: (s: string) => string | null = (s) => s.trim() || null, scope = lines) => {
    if (f[k].status !== "not_found") return;
    for (const l of scope) {
      const m = re.exec(l.text);
      if (!m || !m[group]) continue;
      const raw = m[group];
      const value = norm(raw);
      if (!value) continue;
      set(k, field(raw.trim(), value, wordsForMatch(l, m.index + m[0].indexOf(raw), raw.length), l));
      return;
    }
  };

  // Тип документа
  for (const l of lines.slice(0, 40)) {
    let t: string | null = null;
    if (/КС\s*-?\s*2|акт\S*\s+о\s+при[её]мке\s+выполненных\s+работ/i.test(l.text)) t = "Акт о приёмке выполненных работ (КС-2)";
    else if (/акт\S*\s+выполненных\s+работ|аткарылган\s+иштердин\s+акты/i.test(l.text)) t = "Акт выполненных работ";
    else if (/КС\s*-?\s*3|справк\S*\s+о\s+стоимости/i.test(l.text)) t = "Справка о стоимости работ (КС-3)";
    if (t) {
      set("docType", field(l.text, t, l.words, l));
      break;
    }
  }

  // Номер и дата: «АКТ № 15 от 20.10.2026», «Акт выполненных работ №7»
  tryRe("number", /(?:акт\S*|актысы|akt)[^№\n]{0,60}№\s*([\p{L}\p{N}\-/.]+)/iu, 1, (s) => s.replace(/[.,]$/, "") || null);
  tryRe("date", new RegExp(String.raw`(?:акт\S*|актысы)[^\n]{0,80}?\sот\s+(${DATE})`, "i"), 1, parseDocDate);
  // Форма КС-2: таблица «Номер документа | Дата составления», значения в следующей строке
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/номер\s+документа/i.test(lines[i].text) || !/дата\s+составления/i.test(lines[i].text)) continue;
    const next = lines[i + 1];
    const tokens = next.words;
    const dateIdx = tokens.findIndex((w) => parseDocDate(w.text));
    if (dateIdx > 0 && f.number.status === "not_found") {
      const numWords = tokens.slice(0, dateIdx);
      set("number", field(joinWords(numWords), joinWords(numWords).replace(/\s+/g, ""), numWords, next));
    }
    if (dateIdx >= 0) set("date", field(tokens[dateIdx].text, parseDocDate(tokens[dateIdx].text), [tokens[dateIdx]], next));
    break;
  }
  // Период
  tryRe("periodFrom", new RegExp(String.raw`(?:отч[её]тн\S*\s+период|за\s+период)[^\n]{0,20}?с\s+(${DATE})`, "i"), 1, parseDocDate);
  tryRe("periodTo", new RegExp(String.raw`(?:отч[её]тн\S*\s+период|за\s+период)[^\n]{0,60}?по\s+(${DATE})`, "i"), 1, parseDocDate);
  for (let i = 0; i < lines.length - 1 && f.periodFrom.status === "not_found"; i++) {
    if (!/отч[её]тн\S*\s+период/i.test(lines[i].text)) continue;
    const dates = lines[i + 1].words.filter((w) => parseDocDate(w.text));
    if (dates.length >= 2) {
      set("periodFrom", field(dates[0].text, parseDocDate(dates[0].text), [dates[0]], lines[i + 1]));
      set("periodTo", field(dates[1].text, parseDocDate(dates[1].text), [dates[1]], lines[i + 1]));
    }
  }

  // Стороны
  const party = (s: string) =>
    s
      .replace(/^[\s:.\-–—]+/, "")
      .replace(/\s+(ИНН|адрес|тел)(?![а-яё]).*$/i, "")
      .replace(/[_]{2,}.*$/, "")
      .trim()
      .slice(0, 200) || null;
  tryRe("customerName", /^(?:Заказчик|Инвестор|Буюртмачы)\S*\s*[:\-–]?\s*(.{3,})$/i, 1, party);
  tryRe("contractorName", /^(?:Подрядчик|Субподрядчик|Исполнитель|Мердигер)\S*\s*(?:\(\s*субподрядчик\s*\))?\s*[:\-–]?\s*(.{3,})$/i, 1, party);
  // ИНН рядом с подрядчиком
  const cIdx = lines.findIndex((l) => /^(?:Подрядчик|Субподрядчик|Исполнитель|Мердигер)/i.test(l.text));
  if (cIdx >= 0) tryRe("contractorInn", /ИНН\s*[:№]?\s*(\d[\dОO ]{9,16}\d)/i, 1, (s) => {
    const d = s.replace(/[ОO]/g, "0").replace(/\s/g, "");
    return /^\d{10,14}$/.test(d) ? d : null;
  }, lines.slice(cIdx, cIdx + 3));

  // Договор
  tryRe("contractNumber", /договор\S*(?:\s*\(контракт\))?(?:\s+[а-я]+){0,2}?\s*№\s*([\p{L}\p{N}\-/.]+)/iu, 1, (s) => s.replace(/[.,]$/, "") || null);
  tryRe("contractDate", new RegExp(String.raw`договор\S*[^\n]{0,60}?№\s*[\p{L}\p{N}\-/.]+\s+от\s+(${DATE})`, "iu"), 1, parseDocDate);

  // Стройка / объект / корпус
  tryRe("projectName", /^(?:Стройка|Проект|Курулуш)\S*\s*[:\-–]?\s*(.{3,})$/i, 1, party);
  tryRe("objectText", /^(?:Объект|Корпус|Блок|Этап|Объекти)\S*\s*[:\-–]?\s*(.{1,})$/i, 0, party);

  // Итоги
  for (const l of lines) {
    const last = lastNumber(l);
    if (!last) continue;
    if (/(в\s+т\.?\s*ч\.?|в\s+том\s+числе)?\s*НДС/i.test(l.text) && !/без\s+НДС/i.test(l.text) && !/всего\s+с\s+ндс|итого\s+с\s+ндс/i.test(l.text)) {
      set("vatAmount", field(last.raw, last.value, last.words, l, last.corrected));
    } else if (/^\s*(всего|итого\s+с\s+(ндс|уч[её]том)|итого\s+по\s+акту|всего\s+по\s+акту|баары)/i.test(l.text)) {
      // «Всего» — последняя итоговая строка документа (перезаписываем более поздней)
      f.total = field(last.raw, last.value, last.words, l, last.corrected);
    } else if (/^\s*(итого|жыйынтыгы)/i.test(l.text) && f.subtotal.status === "not_found") {
      set("subtotal", field(last.raw, last.value, last.words, l, last.corrected));
    }
  }
  if (f.total.status === "not_found" && f.subtotal.status !== "not_found" && f.vatAmount.status === "not_found") {
    // Единственный итог — считаем его итогом акта
    f.total = { ...f.subtotal };
  }

  // Сумма прописью
  for (const l of lines) {
    const m = /(?:прописью\s*[:\-–]?\s*)?([А-ЯЁ][а-яё]+(?:\s+[а-яё]+){2,}\s+(?:сом|сома|сомов|рубл\S*)[^\n]*)/.exec(l.text);
    if (m && parseAmountInWords(m[1])) {
      set("amountInWords", field(m[1].trim(), parseAmountInWords(m[1]), wordsForMatch(l, m.index, m[0].length), l));
      break;
    }
  }

  // Подписанты
  const sig = lines.filter((l) => /^(Сдал|Принял|Тапшырды|Кабыл\s+алды)/i.test(l.text)).map((l) => l.text.replace(/_{2,}/g, " ").replace(/\s+/g, " ").trim());
  if (sig.length) {
    const sl = lines.find((l) => /^(Сдал|Принял|Тапшырды|Кабыл\s+алды)/i.test(l.text))!;
    set("signatories", field(sig.join("; "), sig.join("; "), sl.words, sl));
  }

  // Номера: латинские буквы-двойники в кириллическом документе приводим к кириллице (с пометкой «исправлено»)
  for (const k of ["number", "contractNumber"] as const) {
    const v = f[k].value;
    if (!v) continue;
    const fixed = cyrillicLookalikes(v, fullText);
    if (fixed !== v) f[k] = { ...f[k], value: fixed, corrected: true, status: "low_confidence" };
  }

  // Валюта
  const cur = detectCurrency(fullText);
  if (cur) f.currency = { raw: cur, value: cur, confidence: null, bbox: null, status: "recognized" };
  return f;
}

const LAT_TO_CYR: Record<string, string> = { A: "А", B: "В", E: "Е", K: "К", M: "М", H: "Н", O: "О", P: "Р", C: "С", T: "Т", X: "Х", Y: "У" };

/** «ABP-15» → «АВР-15», если все латинские буквы — двойники кириллических, а документ преимущественно кириллический. */
export function cyrillicLookalikes(v: string, context: string): string {
  const latin = v.match(/[A-Za-z]/g) ?? [];
  if (!latin.length || !latin.every((c) => c in LAT_TO_CYR)) return v;
  const cyr = (context.match(/[А-Яа-яЁё]/g) ?? []).length;
  const lat = (context.match(/[A-Za-z]/g) ?? []).length;
  if (cyr < lat * 3) return v;
  return v.replace(/[A-Z]/g, (c) => LAT_TO_CYR[c] ?? c);
}

function lastNumber(l: PLine): { raw: string; value: string; words: OcrWord[]; corrected: boolean } | null {
  // Число может быть разбито на несколько слов («1 250 000,00») — собираем хвост строки из числовых токенов
  const ws = l.words;
  let end = ws.length - 1;
  while (end >= 0 && !/\d/.test(ws[end].text)) end--;
  if (end < 0) return null;
  let start = end;
  while (start > 0 && /^[\dОO.,\-]+$/.test(ws[start - 1].text) && /^\d{1,3}$/.test(ws[start].text.replace(/[.,]\d+$/, ""))) start--;
  const parts = ws.slice(start, end + 1);
  const raw = parts.map((w) => w.text).join(" ");
  const n = normalizeNumber(raw);
  if (!n.ok || n.value === null) return null;
  return { raw, value: n.value, words: parts, corrected: n.corrected };
}

// ───────────── Таблица ─────────────

const HEADER_KEYS: [LineColumn, RegExp][] = [
  ["lineNo", /^(№|n|п\/п|по\s*порядку|nn)$/i],
  ["code", /^(шифр|код|расцен|обоснов|позиц|номер\s*един)/i],
  ["name", /^(наимен|вид|аталыш)/i],
  ["unit", /^(ед\.?|единиц|изм|бирдиг)/i],
  ["quantity", /^(кол|колич|объ[её]м|саны)/i],
  ["unitPrice", /^(цена|стоимость\s*един|баасы)/i],
  ["amount", /^(сумма|стоимость|всего|наркы|суммасы)/i],
];

interface ColumnModel {
  /** Центры колонок в долях ширины страницы */
  centers: Partial<Record<LineColumn, number>>;
}

function headerKeys(l: PLine, centers: Partial<Record<LineColumn, number>>): number {
  let hits = 0;
  for (const w of l.words) {
    const t = w.text.toLowerCase().replace(/[,:;]$/, "");
    for (const [col, re] of HEADER_KEYS) {
      if (centers[col] !== undefined || !re.test(t)) continue;
      const after = l.text.toLowerCase().slice(l.text.toLowerCase().indexOf(t), l.text.toLowerCase().indexOf(t) + t.length + 12);
      // «Стоимость единицы» — это цена, а не сумма
      const target: LineColumn = col === "amount" && /стоимость/.test(t) && /един/.test(after) ? "unitPrice" : col;
      if (centers[target] !== undefined) break;
      centers[target] = (w.left + w.width / 2) / l.pw;
      hits++;
      break;
    }
  }
  return hits;
}

/** Заголовок таблицы: строка с ≥ 3 ключевыми словами (включая «наименование»), дополняется 1–2 следующими строками многострочного заголовка. */
function detectHeader(lines: PLine[], startIdx: number): { model: ColumnModel; endIdx: number } | null {
  for (let i = startIdx; i < lines.length; i++) {
    const centers: Partial<Record<LineColumn, number>> = {};
    const hits = headerKeys(lines[i], centers);
    if (hits < 3 || centers.name === undefined) continue;
    let end = i + 1;
    while (end < Math.min(lines.length, i + 3) && !looksLikeData(lines[end]) && !isNumberingRow(lines[end])) {
      headerKeys(lines[end], centers);
      end++;
    }
    if (centers.amount === undefined && centers.quantity === undefined) continue;
    if (end < lines.length && isNumberingRow(lines[end])) {
      refineByNumbering(lines[end], centers);
      end++;
    }
    return { model: { centers }, endIdx: end };
  }
  return null;
}

function isNumberingRow(l: PLine): boolean {
  const tokens = l.words.map((w) => w.text.replace(/[.,:;|]+$/, "")).filter(Boolean);
  const nums = tokens.filter((t) => /^\d{1,2}$/.test(t));
  // допускаем один «мусорный» токен от OCR
  return nums.length >= 4 && nums.length >= tokens.length - 1 && nums.every((n, i) => i === 0 || Number(n) > Number(nums[i - 1]));
}

/** Строка нумерации «1 2 3 … 8» уточняет центры колонок (в порядке их следования слева направо). */
function refineByNumbering(l: PLine, centers: Partial<Record<LineColumn, number>>) {
  const known = (Object.entries(centers) as [LineColumn, number][]).sort((a, b) => a[1] - b[1]);
  const nums = l.words.map((w) => (w.left + w.width / 2) / l.pw);
  // каждой известной колонке сопоставляем ближайший номер
  for (const [col, x] of known) {
    let best = -1;
    let bd = 1;
    for (const [i, nx] of nums.entries()) {
      const d = Math.abs(nx - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0 && bd < 0.08) centers[col] = nums[best];
  }
}

function looksLikeData(l: PLine): boolean {
  const numeric = l.words.filter((w) => /\d/.test(w.text)).length;
  return numeric >= 2 && l.words.length >= 3;
}

function assign(l: PLine, model: ColumnModel): Record<LineColumn, OcrWord[]> {
  const cols = (Object.entries(model.centers) as [LineColumn, number][]).sort((a, b) => a[1] - b[1]);
  const out = Object.fromEntries(LINE_COLUMNS.map((c) => [c, [] as OcrWord[]])) as Record<LineColumn, OcrWord[]>;
  // Узкие колонки (№, шифр, ед., количество, цена, сумма) занимают зону вокруг своего центра;
  // широкая колонка «наименование» (текст выровнен влево) получает всё между соседними зонами.
  const zones = cols.map(([col, x], i) => {
    if (col === "name") return null;
    const left = i > 0 && cols[i - 1][0] !== "name" ? x - cols[i - 1][1] : Infinity;
    const right = i < cols.length - 1 && cols[i + 1][0] !== "name" ? cols[i + 1][1] - x : Infinity;
    let half = Math.min(left, right) / 2;
    if (!isFinite(half)) half = 0.06;
    return { col, from: x - half, to: x + half };
  });
  const nameIdx = cols.findIndex(([c]) => c === "name");
  for (const w of l.words) {
    const x = (w.left + w.width / 2) / l.pw;
    const z = zones.find((zz) => zz && x >= zz.from && x <= zz.to);
    if (z) {
      out[z.col].push(w);
      continue;
    }
    if (nameIdx >= 0) {
      const leftEdge = nameIdx > 0 ? zones[nameIdx - 1]!.to : -Infinity;
      const rightEdge = nameIdx < cols.length - 1 ? zones[nameIdx + 1]!.from : Infinity;
      if (x > leftEdge && x < rightEdge) {
        out.name.push(w);
        continue;
      }
    }
    // ближайшая колонка по центру
    let best = cols[0][0];
    let bd = Infinity;
    for (const [col, cx] of cols) {
      const d = Math.abs(cx - x);
      if (d < bd) {
        bd = d;
        best = col;
      }
    }
    out[best].push(w);
  }
  return out;
}

function cell(words: OcrWord[], numeric: boolean): RecCell {
  if (!words.length) return { raw: null, value: null, confidence: null };
  const raw = joinWords(words).replace(/\t/g, " ");
  const c = conf(words);
  // артефакты линий таблицы в начале/конце текстовой ячейки («— Монолитные…», «|»)
  if (!numeric) return { raw, value: raw.replace(/^[\s—–\-|_.,:;]+|[\s|_]+$/g, "").trim() || null, confidence: c };
  const n = normalizeNumber(raw);
  return { raw, value: n.ok ? n.value : null, confidence: n.corrected ? Math.min(c ?? 100, LOW_CONFIDENCE - 1) : c, corrected: n.corrected };
}

const TOTAL_LINE = /^\s*(итого|всего|в\s+т\.?\s*ч|в\s+том\s+числе|ндс|жыйынтыгы|баары)/i;
const CHARGES_LINE = /(накладн|сметн\S*\s+прибыл|коэффициент|зимн|непредвиден|удорожан|индекс)/i;

function extractTable(lines: PLine[]): { lines: RecLine[]; hasCharges: boolean; warnings: string[] } {
  const out: RecLine[] = [];
  const warnings: string[] = [];
  let model: ColumnModel | null = null;
  let hasCharges = false;
  let section: string | null = null;
  let finished = false;
  const pages = [...new Set(lines.map((l) => l.page))].sort((a, b) => a - b);

  for (const page of pages) {
    const pl = lines.filter((l) => l.page === page);
    let idx = 0;
    const header = detectHeader(pl, 0);
    if (header) {
      model = header.model;
      idx = header.endIdx;
    } else if (model) {
      // продолжение таблицы: пропускаем строку нумерации колонок, если она повторена
      const num = pl.findIndex(isNumberingRow);
      if (num >= 0 && num < 5) {
        refineByNumbering(pl[num], model.centers);
        idx = num + 1;
      }
    } else continue;
    if (finished && !header) continue;
    finished = false;

    for (let i = idx; i < pl.length; i++) {
      const l = pl[i];
      if (TOTAL_LINE.test(l.text)) {
        // итог по разделу/странице — таблица может продолжаться, «Всего» завершает
        if (/^\s*(всего|баары)/i.test(l.text)) finished = true;
        if (finished) break;
        continue;
      }
      if (CHARGES_LINE.test(l.text) && !looksLikeItem(l, model!)) {
        hasCharges = true;
        continue;
      }
      if (isNumberingRow(l)) continue;
      const a = assign(l, model!);
      const nums = {
        quantity: cell(a.quantity, true),
        unitPrice: cell(a.unitPrice, true),
        amount: cell(a.amount, true),
      };
      const hasNumbers = nums.quantity.value !== null || nums.unitPrice.value !== null || nums.amount.value !== null;
      const lineNo = cell(a.lineNo, false);
      const name = cell(a.name, false);
      if (!hasNumbers) {
        const text = l.text.replace(/\t/g, " ").trim();
        if (/^(раздел|глава|бөлүм)/i.test(text) || (!lineNo.value && out.length === 0)) {
          section = text;
          continue;
        }
        // продолжение наименования предыдущей строки (перенос внутри ячейки)
        const prev = out[out.length - 1];
        if (prev && !lineNo.value && prev.page === page) {
          const add = [cell(a.code, false).raw, name.raw].filter(Boolean).join(" ") || text;
          prev.cells.name = {
            raw: [prev.cells.name.raw, add].filter(Boolean).join(" "),
            value: [prev.cells.name.value, add].filter(Boolean).join(" "),
            confidence: minNull(prev.cells.name.confidence, conf(l.words)),
          };
          if (prev.bbox) {
            const b = bboxOf(l.words, page, l.pw, l.ph)!;
            const top = Math.min(prev.bbox.y, b.y);
            prev.bbox = { ...prev.bbox, y: top, h: Math.max(prev.bbox.y + prev.bbox.h, b.y + b.h) - top, x: Math.min(prev.bbox.x, b.x), w: Math.max(prev.bbox.x + prev.bbox.w, b.x + b.w) - Math.min(prev.bbox.x, b.x) };
          }
          continue;
        }
        if (lineNo.value) {
          section = text;
          continue;
        }
        continue;
      }
      // Строка без наименования и шифра — не позиция (шум OCR, нумерация колонок)
      if (!/[A-Za-zА-Яа-яЁё]{2,}/.test(name.value ?? "") && !cell(a.code, false).value) continue;
      out.push({
        key: `p${page}-l${i}`,
        page,
        bbox: bboxOf(l.words, page, l.pw, l.ph),
        section,
        cells: {
          lineNo,
          code: cell(a.code, false),
          name,
          unit: cell(a.unit, false),
          ...nums,
        },
      });
    }
  }
  if (!model) warnings.push("Не найден заголовок таблицы работ (наименование, количество, сумма) — строки не извлечены");
  return { lines: out, hasCharges, warnings };
}

function looksLikeItem(l: PLine, model: ColumnModel): boolean {
  const a = assign(l, model);
  return a.quantity.length > 0 && a.unitPrice.length > 0;
}

function minNull(a: number | null, b: number | null) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

// ───────────── Точка входа ─────────────

export function parseActPages(pages: OcrPage[]): ActParseResult {
  const lines: PLine[] = pages.flatMap((p, i) => wordsToLines(p.words).map((l) => ({ ...l, page: i + 1, pw: p.width, ph: p.height })));
  const fullText = lines.map((l) => l.text.replace(/\t/g, " ")).join("\n");
  const fields = extractHeader(lines, fullText);
  const table = extractTable(lines);
  const warnings = [...table.warnings];
  if (fields.docType.value?.includes("КС-3")) warnings.push("Документ похож на справку КС-3, а не на акт выполненных работ");
  if (!fields.docType.value) warnings.push("Тип документа не определён");
  return { fields, lines: table.lines, warnings, hasCharges: table.hasCharges, fullText };
}
