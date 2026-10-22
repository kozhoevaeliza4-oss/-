/**
 * Импорт сметы из табличного файла: автоопределение столбцов, разбор строк, проверка данных.
 * Чистые функции — без БД. Результат показывается пользователю в предпросмотре до записи.
 */
import { Cell, Sheet, colLetter, parseNumberCell } from "./tabular";
import { dec } from "@/lib/calc/decimal";
import { plannedCost } from "@/lib/calc/workItem";

export const ESTIMATE_FIELDS = {
  lineNo: "№ п/п",
  code: "Код / шифр расценки",
  name: "Наименование работ *",
  unit: "Ед. изм.",
  quantity: "Количество (объём)",
  unitPrice: "Цена за единицу",
  total: "Стоимость (итог)",
  section: "Раздел сметы",
  object: "Корпус / объект",
  stage: "Этап",
} as const;

export type EstimateField = keyof typeof ESTIMATE_FIELDS;

export type SectionMode = "column" | "header-rows" | "none";
export type KeyMode = "code_name" | "code" | "lineNo";

export interface EstimateMapping {
  sheetIndex: number;
  /** Номер строки заголовков (с 1). Данные начинаются со следующей строки. */
  headerRow: number;
  columns: Partial<Record<EstimateField, number>>;
  sectionMode: SectionMode;
  keyMode: KeyMode;
  defaultObjectCode: string | null;
  defaultStageCode: string | null;
}

// Порядок важен: более специфичные синонимы проверяются раньше («цена за ед.» раньше «стоимость»).
const SYNONYMS: [EstimateField, RegExp][] = [
  ["lineNo", /^(№|n|no|номер)\s*(п\/п|пп|по порядку)?$/],
  ["lineNo", /^№\s*п\.?\s*\/?\s*п\.?$/],
  ["code", /^(шифр|код|обоснование|шифр расценки|код расценки|№ расценки|номер расценки|шифр и номер позиции норматива|расценка)/],
  ["name", /^(наименование|вид(ы)? работ|описание работ|работы|позиция)/],
  ["unit", /^(ед\.?\s*изм|единица измерения|ед\.?$|единица)/],
  ["quantity", /^(кол-во|количество|объ[её]м|кол\.)/],
  ["unitPrice", /^(цена|стоимость (за )?ед|стоимость единицы|ед\.? стоимость|расценка за ед|сметная цена)/],
  ["total", /^(стоимость|сумма|всего|общая стоимость|итого|сметная стоимость)/],
  ["section", /^раздел/],
  ["object", /^(корпус|объект|блок|дом)/],
  ["stage", /^(этап|очередь)/],
];

function normHeader(c: Cell): string {
  return String(c ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[,:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectHeaderColumns(row: Cell[]): Partial<Record<EstimateField, number>> {
  const result: Partial<Record<EstimateField, number>> = {};
  row.forEach((cell, idx) => {
    const h = normHeader(cell);
    if (!h || h.length > 80) return;
    for (const [field, re] of SYNONYMS) {
      if (result[field] !== undefined) continue;
      if (re.test(h)) {
        result[field] = idx;
        return;
      }
    }
  });
  return result;
}

/** Автоматический подбор листа, строки заголовков и столбцов. Пользователь может всё изменить. */
export function guessEstimateMapping(sheets: Sheet[]): EstimateMapping {
  let best = { sheetIndex: 0, headerRow: 1, columns: {} as Partial<Record<EstimateField, number>>, score: -1 };
  sheets.forEach((sheet, sheetIndex) => {
    sheet.rows.slice(0, 40).forEach((row, i) => {
      const columns = detectHeaderColumns(row);
      const keys = Object.keys(columns);
      const score = keys.length + (columns.name !== undefined ? 3 : 0);
      if (score > best.score) best = { sheetIndex, headerRow: i + 1, columns, score };
    });
  });
  return {
    sheetIndex: best.sheetIndex,
    headerRow: best.headerRow,
    columns: best.columns,
    sectionMode: best.columns.section !== undefined ? "column" : "header-rows",
    keyMode: "code_name",
    defaultObjectCode: null,
    defaultStageCode: null,
  };
}

// ───────────── Предпросмотр ─────────────

export interface Issue {
  level: "error" | "warning" | "info";
  field?: EstimateField;
  message: string;
}

export interface PreviewLine {
  rowNumber: number;
  lineNo: string | null;
  code: string | null;
  name: string;
  unit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  total: string | null;
  computedTotal: string | null;
  plannedCost: string | null;
  sectionCode: string | null;
  sectionName: string | null;
  objectCode: string | null;
  stageCode: string | null;
  itemKey: string;
  issues: Issue[];
}

export interface SkippedRow {
  rowNumber: number;
  reason: string;
  text: string;
  value?: string | null;
}

export interface EstimatePreview {
  sheetName: string;
  lines: PreviewLine[];
  skipped: SkippedRow[];
  sections: { code: string; name: string }[];
  objectCodes: string[];
  stageCodes: string[];
  errorCount: number;
  warningCount: number;
  /** Сумма плановых стоимостей строк (итог сметы, а при отсутствии — объём × цена) */
  totalPlanned: string;
  linesWithoutCost: number;
  /** Итоговые строки файла («Итого», «Всего») — для сверки с суммой строк */
  fileTotals: SkippedRow[];
  truncated: boolean;
  mappingErrors: string[];
}

const TOTAL_ROW = /^(итого|всего|итог|в том числе|в т\.ч\.|ндс|накладные|сметная прибыль)/i;
const SECTION_ROW = /^раздел\s*(№\s*)?([\w.\-]+)?[.:)]?\s*(.*)$/i;

export function normKey(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function str(c: Cell | undefined): string | null {
  if (c === null || c === undefined) return null;
  const s = String(c).trim();
  return s === "" ? null : s;
}

/** «2. Кровля» → {code: "2", name: "Кровля"}; «Кровля» → {code: "Кровля", name: "Кровля"} */
export function splitSection(text: string): { code: string; name: string } {
  const m = SECTION_ROW.exec(text);
  if (m && (m[2] || m[3])) {
    const code = m[2] ?? m[3];
    return { code: code.replace(/\.$/, ""), name: (m[3] || text).trim() };
  }
  const n = /^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/.exec(text);
  if (n) return { code: n[1], name: n[2].trim() };
  return { code: text.slice(0, 40), name: text };
}

export function buildEstimatePreview(sheets: Sheet[], mapping: EstimateMapping): EstimatePreview {
  const sheet = sheets[mapping.sheetIndex];
  const empty: EstimatePreview = {
    sheetName: sheet?.name ?? "",
    lines: [],
    skipped: [],
    sections: [],
    objectCodes: [],
    stageCodes: [],
    errorCount: 0,
    warningCount: 0,
    totalPlanned: "0",
    linesWithoutCost: 0,
    fileTotals: [],
    truncated: sheet?.truncated ?? false,
    mappingErrors: [],
  };
  if (!sheet) return { ...empty, mappingErrors: ["Лист не найден"] };
  const col = mapping.columns;
  const mappingErrors: string[] = [];
  if (col.name === undefined) mappingErrors.push("Не выбран столбец «Наименование работ»");
  if (col.quantity === undefined && col.total === undefined && col.unitPrice === undefined)
    mappingErrors.push("Не выбран ни один из столбцов: количество, цена, стоимость");
  if (mapping.sectionMode === "column" && col.section === undefined) mappingErrors.push("Выбран режим «раздел из столбца», но столбец раздела не указан");
  const used = new Map<number, EstimateField>();
  for (const [f, idx] of Object.entries(col) as [EstimateField, number][]) {
    if (used.has(idx)) mappingErrors.push(`Столбец ${colLetter(idx)} выбран и для «${ESTIMATE_FIELDS[used.get(idx)!]}», и для «${ESTIMATE_FIELDS[f]}»`);
    used.set(idx, f);
  }
  if (mappingErrors.length) return { ...empty, mappingErrors };

  const get = (row: Cell[], f: EstimateField): Cell => (col[f] === undefined ? null : row[col[f]!] ?? null);

  const lines: PreviewLine[] = [];
  const skipped: SkippedRow[] = [];
  const fileTotals: SkippedRow[] = [];
  const sections = new Map<string, string>();
  let currentSection: { code: string; name: string } | null = null;
  let total = dec(0)!;
  let linesWithoutCost = 0;

  for (let i = mapping.headerRow; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const rowNumber = i + 1;
    if (!row || row.every((c) => c === null)) continue;

    const nameCell = get(row, "name");
    const qtyCell = get(row, "quantity");
    const priceCell = get(row, "unitPrice");
    const totalCell = get(row, "total");
    const unitCell = get(row, "unit");
    const firstText = row.find((c) => typeof c === "string") as string | undefined;

    // Строка нумерации столбцов (1, 2, 3, …) сразу под заголовком
    if (row.every((c) => c === null || typeof c === "number" || /^\d+$/.test(String(c))) && (nameCell === null || typeof nameCell === "number" || /^\d+$/.test(String(nameCell)))) {
      skipped.push({ rowNumber, reason: "Служебная строка (нумерация столбцов)", text: row.filter((c) => c !== null).join(" ") });
      continue;
    }

    const name = str(nameCell);
    const textForChecks = name ?? firstText ?? "";

    if (TOTAL_ROW.test(textForChecks)) {
      const t = parseNumberCell(totalCell);
      const rec = { rowNumber, reason: "Итоговая строка — не импортируется", text: textForChecks, value: t.ok ? t.value : null };
      skipped.push(rec);
      fileTotals.push(rec);
      continue;
    }

    const noNumbers = qtyCell === null && priceCell === null && totalCell === null && unitCell === null;
    if (mapping.sectionMode === "header-rows" && noNumbers) {
      const nonEmpty = row.filter((c) => c !== null);
      if (SECTION_ROW.test(textForChecks) || (nonEmpty.length === 1 && textForChecks)) {
        currentSection = splitSection(textForChecks);
        sections.set(currentSection.code, currentSection.name);
        skipped.push({ rowNumber, reason: "Заголовок раздела", text: textForChecks });
        continue;
      }
    }

    const issues: Issue[] = [];
    const nums: Record<"quantity" | "unitPrice" | "total", string | null> = { quantity: null, unitPrice: null, total: null };
    for (const f of ["quantity", "unitPrice", "total"] as const) {
      const p = parseNumberCell(get(row, f));
      if (p.ok) nums[f] = p.value;
      else issues.push({ level: "error", field: f, message: `«${ESTIMATE_FIELDS[f]}»: не число («${p.raw}»)` });
    }

    if (!name) {
      if (nums.quantity !== null || nums.total !== null || nums.unitPrice !== null) {
        issues.push({ level: "error", field: "name", message: "Нет наименования работы при заполненных числовых полях" });
      } else {
        skipped.push({ rowNumber, reason: "Нет наименования и числовых данных", text: row.filter((c) => c !== null).join(" ") });
        continue;
      }
    }

    let section: { code: string; name: string } | null = null;
    if (mapping.sectionMode === "column") {
      const s = str(get(row, "section"));
      section = s ? splitSection(s) : null;
      if (section) sections.set(section.code, section.name);
    } else if (mapping.sectionMode === "header-rows") section = currentSection;

    const objectCode = str(get(row, "object")) ?? mapping.defaultObjectCode;
    const stageCode = str(get(row, "stage")) ?? mapping.defaultStageCode;
    const lineNo = str(get(row, "lineNo"));
    const code = str(get(row, "code"));

    const pc = plannedCost({ quantity: dec(nums.quantity), unitPrice: dec(nums.unitPrice), sourceTotal: dec(nums.total) });
    if (pc.value === null) {
      linesWithoutCost++;
      issues.push({ level: "warning", message: "Нет плановой стоимости (не указаны итог или объём и цена)" });
    } else total = total.plus(pc.value);
    if (nums.quantity === null) issues.push({ level: "warning", field: "quantity", message: "Не указан плановый объём" });
    else if (dec(nums.quantity)!.isZero()) issues.push({ level: "warning", field: "quantity", message: "Плановый объём равен нулю" });
    if (pc.hasDiscrepancy)
      issues.push({ level: "warning", field: "total", message: `Итог отличается от объёма × цены на ${pc.discrepancy!.toFixed(2)}` });
    for (const f of ["quantity", "unitPrice", "total"] as const)
      if (nums[f] !== null && dec(nums[f])!.isNegative()) issues.push({ level: "warning", field: f, message: `Отрицательное значение «${ESTIMATE_FIELDS[f]}»` });
    if (mapping.keyMode === "code" && !code) issues.push({ level: "info", field: "code", message: "Нет кода — для сопоставления используется наименование" });
    if (mapping.keyMode === "lineNo" && !lineNo) issues.push({ level: "error", field: "lineNo", message: "Нет № п/п, выбранного ключом сопоставления" });

    const keyParts =
      mapping.keyMode === "code"
        ? [code ?? `name:${name}`]
        : mapping.keyMode === "lineNo"
          ? [lineNo ?? ""]
          : [code ?? "", name ?? ""];
    const itemKey = [objectCode ?? "", section?.code ?? "", ...keyParts].map(normKey).join("|");

    lines.push({
      rowNumber,
      lineNo,
      code,
      name: name ?? "",
      unit: str(unitCell),
      quantity: nums.quantity,
      unitPrice: nums.unitPrice,
      total: nums.total,
      computedTotal: pc.computed?.toFixed(2) ?? null,
      plannedCost: pc.value?.toFixed(2) ?? null,
      sectionCode: section?.code ?? null,
      sectionName: section?.name ?? null,
      objectCode,
      stageCode,
      itemKey,
      issues,
    });
  }

  // Дубликаты ключа — ошибка: две строки не могут быть одной статьёй
  const byKey = new Map<string, PreviewLine[]>();
  for (const l of lines) byKey.set(l.itemKey, [...(byKey.get(l.itemKey) ?? []), l]);
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const rowsList = group.map((g) => g.rowNumber).join(", ");
    for (const l of group)
      l.issues.push({ level: "error", message: `Ключ статьи повторяется (строки ${rowsList}). Смените режим сопоставления или исправьте файл.` });
  }

  const errorCount = lines.reduce((n, l) => n + l.issues.filter((i) => i.level === "error").length, 0);
  const warningCount = lines.reduce((n, l) => n + l.issues.filter((i) => i.level === "warning").length, 0);

  return {
    sheetName: sheet.name,
    lines,
    skipped,
    sections: [...sections].map(([code, name]) => ({ code, name })),
    objectCodes: [...new Set(lines.map((l) => l.objectCode).filter((x): x is string => !!x))],
    stageCodes: [...new Set(lines.map((l) => l.stageCode).filter((x): x is string => !!x))],
    errorCount,
    warningCount,
    totalPlanned: total.toFixed(2),
    linesWithoutCost,
    fileTotals,
    truncated: sheet.truncated,
    mappingErrors: [],
  };
}

// ───────────── Сравнение версий ─────────────

export interface DiffLineInput {
  itemKey: string;
  code: string | null;
  name: string;
  unit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  plannedCost: string | null;
}

export type DiffKind = "added" | "removed" | "changed" | "unchanged";

export interface DiffRow {
  kind: DiffKind;
  itemKey: string;
  code: string | null;
  name: string;
  unit: string | null;
  before: DiffLineInput | null;
  after: DiffLineInput | null;
  changes: ("name" | "unit" | "quantity" | "unitPrice" | "plannedCost")[];
  costDelta: string | null;
}

export interface VersionDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  totalBefore: string;
  totalAfter: string;
  totalDelta: string;
}

const eqNum = (a: string | null, b: string | null) => {
  const x = dec(a);
  const y = dec(b);
  if (x === null || y === null) return x === y;
  return x.eq(y);
};

export function diffVersions(before: DiffLineInput[], after: DiffLineInput[]): VersionDiff {
  const bMap = new Map(before.map((l) => [l.itemKey, l]));
  const aMap = new Map(after.map((l) => [l.itemKey, l]));
  const rows: DiffRow[] = [];
  const sum = (ls: DiffLineInput[]) => ls.reduce((s, l) => s.plus(dec(l.plannedCost) ?? 0), dec(0)!);

  for (const a of after) {
    const b = bMap.get(a.itemKey) ?? null;
    if (!b) {
      rows.push({ kind: "added", itemKey: a.itemKey, code: a.code, name: a.name, unit: a.unit, before: null, after: a, changes: [], costDelta: a.plannedCost });
      continue;
    }
    const changes: DiffRow["changes"] = [];
    if (normKey(a.name) !== normKey(b.name)) changes.push("name");
    if (normKey(a.unit) !== normKey(b.unit)) changes.push("unit");
    if (!eqNum(a.quantity, b.quantity)) changes.push("quantity");
    if (!eqNum(a.unitPrice, b.unitPrice)) changes.push("unitPrice");
    if (!eqNum(a.plannedCost, b.plannedCost)) changes.push("plannedCost");
    const da = dec(a.plannedCost);
    const db = dec(b.plannedCost);
    rows.push({
      kind: changes.length ? "changed" : "unchanged",
      itemKey: a.itemKey,
      code: a.code,
      name: a.name,
      unit: a.unit,
      before: b,
      after: a,
      changes,
      costDelta: da && db ? da.minus(db).toFixed(2) : null,
    });
  }
  for (const b of before) {
    if (aMap.has(b.itemKey)) continue;
    const db = dec(b.plannedCost);
    rows.push({ kind: "removed", itemKey: b.itemKey, code: b.code, name: b.name, unit: b.unit, before: b, after: null, changes: [], costDelta: db ? db.neg().toFixed(2) : null });
  }
  const tb = sum(before);
  const ta = sum(after);
  return {
    rows,
    added: rows.filter((r) => r.kind === "added").length,
    removed: rows.filter((r) => r.kind === "removed").length,
    changed: rows.filter((r) => r.kind === "changed").length,
    unchanged: rows.filter((r) => r.kind === "unchanged").length,
    totalBefore: tb.toFixed(2),
    totalAfter: ta.toFixed(2),
    totalDelta: ta.minus(tb).toFixed(2),
  };
}
