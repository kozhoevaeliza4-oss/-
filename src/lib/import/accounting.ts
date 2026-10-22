/**
 * Импорт выгрузок 1С (XLSX/CSV): сопоставление столбцов, разбор строк, отпечатки для защиты
 * от повторного учёта, предварительная классификация правилами. Чистые функции без БД.
 *
 * Важно: назначение счетов (1636, 1637 и др.) не предполагается заранее — категория операции
 * определяется правилами проекта и всегда подтверждается пользователем.
 */
import { createHash } from "node:crypto";
import { Cell, Sheet, colLetter, parseNumberCell } from "./tabular";
import { parseDocDate } from "@/lib/extract/normalize";
import { dec, Decimal } from "@/lib/calc/decimal";

export const ACC_FIELDS = {
  date: "Дата *",
  documentNumber: "Документ / номер",
  account: "Счёт (Дт)",
  corrAccount: "Корр. счёт (Кт)",
  debit: "Сумма по дебету",
  credit: "Сумма по кредиту",
  amount: "Сумма",
  currency: "Валюта",
  counterparty: "Контрагент",
  objectText: "Объект / субконто объекта",
  costItemText: "Статья затрат",
  contractText: "Договор",
  nomenclature: "Номенклатура",
  quantity: "Количество",
  comment: "Содержание / назначение",
} as const;

export type AccField = keyof typeof ACC_FIELDS;

export type AmountMode = "amount" | "debit_minus_credit" | "debit" | "credit";

export interface AccountingMapping {
  sheetIndex: number;
  headerRow: number;
  columns: Partial<Record<AccField, number>>;
  amountMode: AmountMode;
  /** Счёт по умолчанию, если в файле его нет (выгрузка по одному счёту, например «карточка счёта 1636») */
  defaultAccount: string | null;
  defaultCurrency: string;
}

const SYN: [AccField, RegExp][] = [
  ["date", /^(дата|период)$/],
  ["documentNumber", /^(документ|регистратор|номер(\s+документа)?|№\s*документа)/],
  ["corrAccount", /^(сч[её]т\s*кт|кт\s*сч|корр?\.?\s*сч|кор\.?\s*сч|сч[её]т\s+кредита|кт)$/],
  ["account", /^(сч[её]т\s*дт|дт\s*сч|сч[её]т(\s+дебета)?|дт)$/],
  ["debit", /^(сумма\s*дт|дебет|оборот\s*дт|приход)/],
  ["credit", /^(сумма\s*кт|кредит|оборот\s*кт|расход)/],
  ["amount", /^(сумма|сумма\s+операции|сумма\s+проводки)$/],
  ["currency", /^валюта/],
  ["counterparty", /^(контрагент|поставщик|подрядчик)/],
  ["objectText", /^(объект|объект\s+строительства|субконто\s*1|подразделение)/],
  ["costItemText", /^(статья|статья\s+затрат|статьи\s+затрат|субконто\s*2)/],
  ["contractText", /^(договор|договоры|субконто\s*3)/],
  ["nomenclature", /^(номенклатура|материал|товар)/],
  ["quantity", /^(количество|кол-во|кол\.)/],
  ["comment", /^(содержание|комментарий|назначение|описание|примечание)/],
];

const norm = (c: Cell) =>
  String(c ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

export function guessAccountingMapping(sheets: Sheet[], defaultCurrency = "KGS"): AccountingMapping {
  let best = { sheetIndex: 0, headerRow: 1, columns: {} as Partial<Record<AccField, number>>, score: -1 };
  sheets.forEach((sh, si) =>
    sh.rows.slice(0, 30).forEach((row, ri) => {
      const cols: Partial<Record<AccField, number>> = {};
      row.forEach((c, idx) => {
        const h = norm(c);
        if (!h || h.length > 60) return;
        for (const [f, re] of SYN) {
          if (cols[f] !== undefined) continue;
          if (re.test(h)) {
            cols[f] = idx;
            return;
          }
        }
      });
      const score = Object.keys(cols).length + (cols.date !== undefined ? 2 : 0) + (cols.amount !== undefined || cols.debit !== undefined ? 2 : 0);
      if (score > best.score) best = { sheetIndex: si, headerRow: ri + 1, columns: cols, score };
    }),
  );
  const c = best.columns;
  const amountMode: AmountMode = c.amount !== undefined ? "amount" : c.debit !== undefined && c.credit !== undefined ? "debit_minus_credit" : c.debit !== undefined ? "debit" : "credit";
  return { sheetIndex: best.sheetIndex, headerRow: best.headerRow, columns: c, amountMode, defaultAccount: null, defaultCurrency };
}

export interface AccRow {
  rowNumber: number;
  date: string | null;
  documentNumber: string | null;
  account: string | null;
  corrAccount: string | null;
  debit: string | null;
  credit: string | null;
  amount: string | null;
  currency: string;
  counterparty: string | null;
  objectText: string | null;
  costItemText: string | null;
  contractText: string | null;
  nomenclature: string | null;
  quantity: string | null;
  comment: string | null;
  /** Все ячейки строки как в файле (с заголовками) — сохраняются как исходные реквизиты */
  raw: Record<string, string | number | null>;
  contentKey: string;
  fingerprint: string;
  errors: string[];
  warnings: string[];
}

export interface AccPreview {
  rows: AccRow[];
  skipped: { rowNumber: number; reason: string; text: string }[];
  mappingErrors: string[];
  errorCount: number;
  sourceTotal: string;
  /** Итоговые строки файла («Итого», «Обороты за период») — для сверки */
  fileTotals: { rowNumber: number; text: string; values: (string | null)[] }[];
}

const TOTAL = /^(итого|всего|обороты\s+за\s+период|сальдо|оборот)/i;

const str = (c: Cell | undefined) => {
  if (c === null || c === undefined) return null;
  const s = String(c).trim();
  return s === "" ? null : s;
};

/** Ключ содержимого операции: дата, документ, счета, аналитика, суммы, содержание. */
export function contentKeyOf(r: Pick<AccRow, "date" | "documentNumber" | "account" | "corrAccount" | "counterparty" | "objectText" | "costItemText" | "contractText" | "nomenclature" | "quantity" | "debit" | "credit" | "amount" | "comment">): string {
  const n = (v: string | null) => (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const num = (v: string | null) => (v === null ? "" : dec(v)?.toFixed(2) ?? v);
  return [r.date, n(r.documentNumber), n(r.account), n(r.corrAccount), n(r.counterparty), n(r.objectText), n(r.costItemText), n(r.contractText), n(r.nomenclature), num(r.quantity), num(r.debit), num(r.credit), num(r.amount), n(r.comment)].join("|");
}

/**
 * Отпечаток операции. Полностью одинаковые строки в одном файле (легитимные повторы) различаются порядковым номером
 * повтора, поэтому повторная загрузка того же файла или пересекающихся выгрузок даёт те же отпечатки.
 */
export function fingerprints(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return createHash("sha256").update(`${k}#${n}`).digest("hex");
  });
}

export function buildAccountingPreview(sheets: Sheet[], m: AccountingMapping): AccPreview {
  const sheet = sheets[m.sheetIndex];
  const empty: AccPreview = { rows: [], skipped: [], mappingErrors: [], errorCount: 0, sourceTotal: "0.00", fileTotals: [] };
  if (!sheet) return { ...empty, mappingErrors: ["Лист не найден"] };
  const c = m.columns;
  const errs: string[] = [];
  if (c.date === undefined) errs.push("Не выбран столбец «Дата»");
  if (m.amountMode === "amount" && c.amount === undefined) errs.push("Не выбран столбец «Сумма»");
  if (m.amountMode === "debit_minus_credit" && (c.debit === undefined || c.credit === undefined)) errs.push("Для режима «дебет − кредит» выберите оба столбца");
  if (m.amountMode === "debit" && c.debit === undefined) errs.push("Не выбран столбец «Сумма по дебету»");
  if (m.amountMode === "credit" && c.credit === undefined) errs.push("Не выбран столбец «Сумма по кредиту»");
  const used = new Map<number, AccField>();
  for (const [f, idx] of Object.entries(c) as [AccField, number][]) {
    if (used.has(idx)) errs.push(`Столбец ${colLetter(idx)} выбран дважды (${ACC_FIELDS[used.get(idx)!]} и ${ACC_FIELDS[f]})`);
    used.set(idx, f);
  }
  if (errs.length) return { ...empty, mappingErrors: errs };

  const header = sheet.rows[m.headerRow - 1] ?? [];
  const headerNames = header.map((h, i) => str(h) ?? colLetter(i));
  const get = (row: Cell[], f: AccField) => (c[f] === undefined ? null : row[c[f]!] ?? null);
  const rows: Omit<AccRow, "fingerprint">[] = [];
  const skipped: AccPreview["skipped"] = [];
  const fileTotals: AccPreview["fileTotals"] = [];
  let total = new Decimal(0);

  for (let i = m.headerRow; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const rowNumber = i + 1;
    if (!row || row.every((x) => x === null)) continue;
    const first = String(row.find((x) => x !== null) ?? "");
    if (TOTAL.test(first)) {
      fileTotals.push({ rowNumber, text: first, values: [get(row, "amount"), get(row, "debit"), get(row, "credit")].map((v) => (v === null ? null : String(v))) });
      skipped.push({ rowNumber, reason: "Итоговая строка", text: first });
      continue;
    }
    const errors: string[] = [];
    const warnings: string[] = [];
    const numOf = (f: AccField) => {
      const p = parseNumberCell(get(row, f));
      if (!p.ok) {
        errors.push(`«${ACC_FIELDS[f]}»: не число («${p.raw}»)`);
        return null;
      }
      return p.value;
    };
    const dateCell = get(row, "date");
    const date = dateCell === null ? null : typeof dateCell === "number" ? excelDate(dateCell) : parseDocDate(String(dateCell));
    const debit = numOf("debit");
    const credit = numOf("credit");
    const amountCol = numOf("amount");
    let amount: string | null = null;
    if (m.amountMode === "amount") amount = amountCol;
    else if (m.amountMode === "debit") amount = debit;
    else if (m.amountMode === "credit") amount = credit;
    else if (debit !== null || credit !== null) amount = (dec(debit) ?? new Decimal(0)).minus(dec(credit) ?? new Decimal(0)).toFixed(2);
    const quantity = numOf("quantity");

    const textCells = row.filter((x) => x !== null).length;
    if (date === null && amount === null && dateCell === null && !errors.length) {
      skipped.push({ rowNumber, reason: "Нет даты и суммы (служебная строка)", text: row.filter((x) => x !== null).join(" ").slice(0, 120) });
      continue;
    }
    if (date === null) errors.push(dateCell === null ? "Нет даты" : `Не распознана дата «${dateCell}»`);
    if (amount === null && !errors.length) errors.push("Нет суммы");
    if (amount !== null && dec(amount)!.isZero()) warnings.push("Нулевая сумма");
    if (textCells <= 2) warnings.push("Мало реквизитов в строке");
    const account = str(get(row, "account")) ?? m.defaultAccount;
    const r = {
      rowNumber,
      date,
      documentNumber: str(get(row, "documentNumber")),
      account,
      corrAccount: str(get(row, "corrAccount")),
      debit,
      credit,
      amount,
      currency: (str(get(row, "currency")) ?? m.defaultCurrency).toUpperCase(),
      counterparty: str(get(row, "counterparty")),
      objectText: str(get(row, "objectText")),
      costItemText: str(get(row, "costItemText")),
      contractText: str(get(row, "contractText")),
      nomenclature: str(get(row, "nomenclature")),
      quantity,
      comment: str(get(row, "comment")),
      raw: Object.fromEntries(row.map((v, k) => [headerNames[k] ?? colLetter(k), v]).filter(([, v]) => v !== null)),
      errors,
      warnings,
    };
    if (!r.objectText && !r.costItemText && !r.contractText) warnings.push("Нет аналитики объекта/статьи/договора — потребуется ручная классификация");
    if (amount !== null && !errors.length) total = total.plus(amount);
    rows.push({ ...r, contentKey: contentKeyOf(r) });
  }
  const fps = fingerprints(rows.map((r) => r.contentKey));
  const out = rows.map((r, i) => ({ ...r, fingerprint: fps[i] }));
  return { rows: out, skipped, mappingErrors: [], errorCount: out.reduce((n, r) => n + r.errors.length, 0), sourceTotal: total.toFixed(2), fileTotals };
}

function excelDate(n: number): string | null {
  if (n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

// ───────────── Правила классификации ─────────────

export interface RuleInput {
  id: string;
  priority: number;
  isActive: boolean;
  account: string | null;
  corrAccount: string | null;
  textContains: string | null;
  counterpartyContains: string | null;
  category: string;
  workItemId: string | null;
  contractId: string | null;
}

const has = (hay: string | null, needle: string) => (hay ?? "").toLowerCase().includes(needle.toLowerCase());

/** Первое подходящее правило (по приоритету). Условия правила объединяются по «И»; пустое условие не проверяется. */
export function matchRule(r: Pick<AccRow, "account" | "corrAccount" | "counterparty" | "objectText" | "costItemText" | "contractText" | "nomenclature" | "comment">, rules: RuleInput[]): RuleInput | null {
  const text = [r.objectText, r.costItemText, r.contractText, r.nomenclature, r.comment].filter(Boolean).join(" ");
  const sorted = [...rules].filter((x) => x.isActive).sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (!rule.account && !rule.corrAccount && !rule.textContains && !rule.counterpartyContains) continue;
    if (rule.account && !(r.account ?? "").startsWith(rule.account)) continue;
    if (rule.corrAccount && !(r.corrAccount ?? "").startsWith(rule.corrAccount)) continue;
    if (rule.textContains && !has(text, rule.textContains)) continue;
    if (rule.counterpartyContains && !has(r.counterparty, rule.counterpartyContains)) continue;
    return rule;
  }
  return null;
}
