import "server-only";
import path from "node:path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ReportResult } from "./reports";
import { fmtDate, fmtMoney, fmtNum, fmtPct } from "@/lib/format";

export interface ExportMeta {
  projectName: string;
  projectCode: string;
  isDemo: boolean;
  generatedAt: Date;
  userName: string;
  filters: string;
}

const headerLines = (r: ReportResult, m: ExportMeta) => [
  `${r.title}`,
  `Проект: ${m.projectCode} — ${m.projectName}${m.isDemo ? " (ДЕМО-ДАННЫЕ, не являются реальными показателями)" : ""}`,
  `Сформирован: ${m.generatedAt.toLocaleString("ru-RU")} · пользователь: ${m.userName} · валюта: ${r.currency}`,
  `Фильтры: ${m.filters || "нет"}`,
  `Методика: ${r.methodology}`,
];

export async function reportToXlsx(r: ReportResult, m: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Construction Control";
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  headerLines(r, m).forEach((l, i) => {
    const row = ws.addRow([l]);
    if (i === 0) row.font = { bold: true, size: 13 };
    else row.font = { italic: i === 4, size: 9 };
  });
  r.notes.forEach((n) => (ws.addRow([n]).font = { size: 9 }));
  ws.addRow(["Пустая ячейка означает отсутствие данных (не ноль)."]).font = { size: 9, italic: true };
  const headerRowIdx = ws.rowCount + 1;
  const hr = ws.addRow(r.columns.map((c) => c.label));
  hr.font = { bold: true };
  hr.alignment = { wrapText: true, vertical: "middle" };
  hr.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } }));
  const conv = (kind: string, v: string | null) => {
    if (v === null || v === undefined) return null;
    if (kind === "money" || kind === "qty" || kind === "pct") {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00Z");
    return v;
  };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => conv(c.kind, row[c.key] ?? null)));
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c, i) => (i === 0 && !r.totals![c.key] ? "Итого" : conv(c.kind, r.totals![c.key] ?? null))));
    t.font = { bold: true };
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? (c.kind === "text" ? 14 : 16);
    if (c.kind === "money") col.numFmt = "#,##0.00";
    if (c.kind === "qty") col.numFmt = "#,##0.####";
    if (c.kind === "pct") col.numFmt = "0.0";
    if (c.kind === "date") col.numFmt = "dd.mm.yyyy";
  });
  ws.views = [{ state: "frozen", ySplit: headerRowIdx }];
  ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: r.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const FONT = path.resolve(process.cwd(), "assets/fonts/DejaVuSans.ttf");
const FONT_BOLD = path.resolve(process.cwd(), "assets/fonts/DejaVuSans-Bold.ttf");

function cellText(kind: string, v: string | null | undefined, currency: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (kind === "money") return fmtMoney(v, currency).replace(/ /g, " ");
  if (kind === "qty") return fmtNum(v, 4).replace(/ /g, " ");
  if (kind === "pct") return fmtPct(v).replace(/ /g, " ");
  if (kind === "date") return fmtDate(v);
  return String(v);
}

/** PDF: альбомная A4, перенос текста в ячейках, повтор заголовка таблицы, номера страниц. */
export function reportToPdf(r: ReportResult, m: ExportMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28, bufferPages: true, info: { Title: r.title, Author: "Construction Control" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("R", FONT);
    doc.registerFont("B", FONT_BOLD);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 14;

    const lines = headerLines(r, m);
    doc.font("B").fontSize(13).text(lines[0], left, doc.y, { width });
    doc.font("R").fontSize(8);
    for (const l of lines.slice(1)) doc.text(l, { width });
    for (const n of r.notes) doc.text(n, { width });
    doc.text("«—» означает отсутствие данных (не ноль).", { width });
    doc.moveDown(0.5);

    const weights = r.columns.map((c) => c.width ?? (c.kind === "text" ? 14 : 15));
    const sumW = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / sumW) * width);
    const FS = r.columns.length > 10 ? 6.5 : 7.5;
    const pad = 2;

    const rowHeight = (texts: string[], bold = false) => {
      doc.font(bold ? "B" : "R").fontSize(FS);
      return Math.max(...texts.map((t, i) => doc.heightOfString(t, { width: widths[i] - pad * 2 }))) + pad * 2;
    };
    const drawRow = (texts: string[], opts: { bold?: boolean; fill?: string; align?: ("left" | "right")[] } = {}) => {
      const h = rowHeight(texts, opts.bold);
      if (doc.y + h > bottom()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      let x = left;
      if (opts.fill) doc.save().rect(left, y, width, h).fill(opts.fill).restore();
      doc.font(opts.bold ? "B" : "R").fontSize(FS).fillColor("#111");
      texts.forEach((t, i) => {
        doc.text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: opts.align?.[i] ?? "left" });
        x += widths[i];
      });
      doc.save().moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.3).strokeColor("#cbd5e1").stroke().restore();
      doc.x = left;
      doc.y = y + h;
    };
    const aligns = r.columns.map((c) => (c.kind === "money" || c.kind === "qty" || c.kind === "pct" ? "right" : "left")) as ("left" | "right")[];
    const drawHeader = () => drawRow(r.columns.map((c) => c.label), { bold: true, fill: "#e2e8f0" });

    drawHeader();
    if (!r.rows.length) {
      doc.font("R").fontSize(9).text("Нет данных по выбранным фильтрам.", left, doc.y + 4);
    }
    for (const row of r.rows) drawRow(r.columns.map((c) => cellText(c.kind, row[c.key], r.currency)), { align: aligns });
    if (r.totals) drawRow(r.columns.map((c, i) => (i === 0 && !r.totals![c.key] ? "Итого" : r.totals![c.key] ? cellText(c.kind, r.totals![c.key], r.currency) : "")), { bold: true, fill: "#f1f5f9", align: aligns });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("R").fontSize(7).fillColor("#64748b").text(`${r.title} · ${m.projectCode} · стр. ${i + 1} из ${range.count}`, left, doc.page.height - doc.page.margins.bottom - 8, { width, align: "right", lineBreak: false });
    }
    doc.end();
  });
}
