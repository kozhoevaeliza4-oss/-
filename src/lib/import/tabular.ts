/**
 * Чтение табличных файлов (XLSX, CSV) в сетку ячеек. Структура строк и столбцов сохраняется.
 * Значения приводятся к string | number | null; даты — к строке YYYY-MM-DD.
 */
import ExcelJS from "exceljs";
import iconv from "iconv-lite";

export type Cell = string | number | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Строка обрезана из-за превышения лимита */
  truncated: boolean;
}

export const MAX_ROWS_PER_SHEET = 50_000;
export const MAX_COLS = 60;

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export async function parseTabular(buffer: Buffer, fileName: string): Promise<Sheet[]> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xlsm") return parseXlsx(buffer);
  if (ext === "csv" || ext === "txt") return [parseCsv(buffer, fileName)];
  if (ext === "xls")
    throw new ParseError("Формат .xls (Excel 97–2003) не поддерживается. Откройте файл в Excel и сохраните как .xlsx.");
  throw new ParseError(`Формат «.${ext}» не поддерживается для табличного импорта. Используйте XLSX или CSV.`);
}

async function parseXlsx(buffer: Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (e) {
    throw new ParseError(`Не удалось прочитать XLSX: ${e instanceof Error ? e.message : "файл повреждён"}`);
  }
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    const truncated = ws.rowCount > MAX_ROWS_PER_SHEET;
    for (let r = 1; r <= Math.min(ws.rowCount, MAX_ROWS_PER_SHEET); r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      const colCount = Math.min(row.cellCount, MAX_COLS);
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        // У объединённых ячеек значение есть только у главной — подчинённые оставляем пустыми,
        // чтобы не дублировать заголовки разделов по всем столбцам.
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) {
          cells.push(null);
          continue;
        }
        cells.push(normalizeCell(cell.value));
      }
      rows.push(trimRow(cells));
    }
    sheets.push({ name: ws.name, rows, truncated });
  });
  if (sheets.length === 0) throw new ParseError("В файле нет листов");
  return sheets;
}

function normalizeCell(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return cleanStr(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return cleanStr(v.richText.map((t) => t.text).join(""));
    if ("result" in v) return normalizeCell((v as { result: ExcelJS.CellValue }).result);
    if ("text" in v) return cleanStr(String((v as { text: unknown }).text));
    if ("error" in v) return null;
  }
  return cleanStr(String(v));
}

function cleanStr(s: string): string | null {
  const t = s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

function trimRow(cells: Cell[]): Cell[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === null) end--;
  return cells.slice(0, end);
}

// ───────────── CSV ─────────────

export function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString("utf8");
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return iconv.decode(buffer, "utf16le");
  const utf8 = buffer.toString("utf8");
  // Выгрузки 1С часто в Windows-1251: если UTF-8 невалиден — пробуем cp1251
  if (utf8.includes("�")) return iconv.decode(buffer, "win1251");
  return utf8;
}

export function parseCsv(buffer: Buffer, name = "CSV"): Sheet {
  const text = decodeText(buffer);
  // Разделитель определяется по первым строкам, а не по одной: выгрузки 1С часто начинаются
  // с заголовка отчёта («Карточка счёта 1636, октябрь»), где запятая не является разделителем
  const head = text.split(/\r?\n/, 30).join("\n");
  const delimiter = [";", "\t", ","].sort((a, b) => count(head, b) - count(head, a))[0];
  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let truncated = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(trimRow(row.slice(0, MAX_COLS).map((f) => cleanStr(f))));
      row = [];
      field = "";
      if (rows.length >= MAX_ROWS_PER_SHEET) {
        truncated = true;
        break;
      }
    } else field += ch;
  }
  if (!truncated && (field !== "" || row.length > 0)) {
    row.push(field);
    rows.push(trimRow(row.slice(0, MAX_COLS).map((f) => cleanStr(f))));
  }
  return { name, rows, truncated };
}

function count(s: string, ch: string) {
  return s.split(ch).length - 1;
}

// ───────────── Числа ─────────────

export type NumParse = { ok: true; value: string | null } | { ok: false; raw: string };

/**
 * Разбор числа из ячейки: «1 234,56», «1234.56», «-12», «(150,00)». Возвращает строку для Decimal.
 * Пустая ячейка — value: null. Нечисловой текст — ok: false.
 */
export function parseNumberCell(v: Cell): NumParse {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "number") return { ok: true, value: numberToString(v) };
  let s = v.replace(/[\s  ]/g, "").replace(/(сом|руб\.?|₽|\$|€|kgs|usd)$/i, "");
  if (s === "" || s === "-" || s === "—") return { ok: true, value: null };
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^−/, "-");
  // Если есть и точка, и запятая — разделитель тысяч тот, что левее
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, raw: v };
  return { ok: true, value: (neg ? "-" : "") + s.replace(/^(-?)0+(?=\d)/, "$1") };
}

/** Число из Excel (double) → строка без артефактов плавающей точки (15 значащих цифр). */
function numberToString(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

/** Буквенное имя столбца: 0 → A, 26 → AA */
export function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
