/**
 * Массовое обновление выполнения через Excel-шаблон. Шаблон выгружается из системы,
 * статьи определяются по служебному идентификатору (столбец «ID статьи»).
 */
import { Cell, Sheet, parseNumberCell } from "./tabular";

export const PROGRESS_TEMPLATE_HEADERS = [
  "ID статьи (не изменять)",
  "Код",
  "Наименование",
  "Ед. изм.",
  "Способ учёта",
  "Плановый объём",
  "Текущее значение",
  "Новое значение (объём накопленным итогом или %)",
  "Дата фиксации (ДД.ММ.ГГГГ)",
  "Комментарий / основание",
] as const;

export interface ProgressRowParsed {
  rowNumber: number;
  itemId: string | null;
  value: string | null;
  asOfDate: string | null;
  comment: string | null;
  errors: string[];
}

function parseDateCell(v: Cell): { ok: boolean; value: string | null } {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "number") {
    // серийная дата Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return { ok: true, value: d.toISOString().slice(0, 10) };
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return { ok: true, value: `${m[1]}-${m[2]}-${m[3]}` };
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return { ok: true, value: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` };
  return { ok: false, value: null };
}

export function parseProgressSheet(sheet: Sheet): { rows: ProgressRowParsed[]; headerError: string | null } {
  const header = sheet.rows[0] ?? [];
  if (!String(header[0] ?? "").startsWith("ID статьи") || !String(header[7] ?? "").startsWith("Новое значение")) {
    return { rows: [], headerError: "Файл не похож на шаблон массового обновления. Скачайте актуальный шаблон из системы." };
  }
  const rows: ProgressRowParsed[] = [];
  for (let i = 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    if (!r || r.every((c) => c === null)) continue;
    const errors: string[] = [];
    const itemId = r[0] === null || r[0] === undefined ? null : String(r[0]).trim();
    const num = parseNumberCell(r[7] ?? null);
    const date = parseDateCell(r[8] ?? null);
    const comment = r[9] === null || r[9] === undefined ? null : String(r[9]).trim() || null;
    if (!num.ok) errors.push(`Новое значение не число («${num.raw}»)`);
    const value = num.ok ? num.value : null;
    if (value === null && num.ok) {
      // строка без нового значения — пропускается (без изменений)
      rows.push({ rowNumber: i + 1, itemId, value: null, asOfDate: null, comment, errors: [] });
      continue;
    }
    if (!itemId) errors.push("Нет ID статьи");
    if (!date.ok) errors.push("Некорректная дата");
    else if (!date.value) errors.push("Не указана дата фиксации");
    if (!comment) errors.push("Не указан комментарий");
    if (value !== null && value.startsWith("-")) errors.push("Отрицательное значение");
    rows.push({ rowNumber: i + 1, itemId, value, asOfDate: date.value, comment, errors });
  }
  return { rows, headerError: null };
}
