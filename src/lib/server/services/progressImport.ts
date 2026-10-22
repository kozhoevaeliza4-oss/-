import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";
import { readDocument, saveUpload } from "../storage";
import { loadRegistry } from "../registry";
import { parseTabular, ParseError } from "@/lib/import/tabular";
import { parseProgressSheet, PROGRESS_TEMPLATE_HEADERS } from "@/lib/import/progress";
import { dec } from "@/lib/calc/decimal";

export async function buildProgressTemplate(projectId: string): Promise<Buffer> {
  const data = await loadRegistry(projectId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Выполнение");
  const h = ws.addRow([...PROGRESS_TEMPLATE_HEADERS]);
  h.font = { bold: true };
  h.alignment = { wrapText: true };
  for (const r of data.rows) {
    ws.addRow([
      r.id,
      r.code,
      r.name,
      r.unit,
      r.measurementType === "QUANTITY" ? "Объём" : "Процент",
      r.plannedQuantity === null ? null : Number(r.plannedQuantity),
      r.measurementType === "QUANTITY" ? (r.actualQuantity === null ? null : Number(r.actualQuantity)) : r.percentRaw === null ? null : Number(r.percentRaw),
      null,
      null,
      null,
    ]);
  }
  [22, 14, 50, 8, 10, 14, 14, 22, 16, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(1).font = { color: { argb: "FF94A3B8" } };
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function startProgressImport(userId: string, projectId: string, file: File | null): Promise<string> {
  const doc = await saveUpload({ file, projectId, kind: "PROGRESS", userId, allowed: ["xlsx"] });
  let error: string | null = null;
  try {
    const sheets = await parseTabular(doc.buffer, doc.originalName);
    error = parseProgressSheet(sheets[0]).headerError;
  } catch (e) {
    error = e instanceof ParseError ? e.message : "Не удалось разобрать файл";
  }
  const job = await prisma.importJob.create({
    data: {
      projectId,
      kind: "PROGRESS",
      status: error ? "FAILED" : "PARSED",
      documentId: doc.id,
      error,
      createdById: userId,
      finishedAt: error ? new Date() : null,
    },
  });
  await logAudit({ userId, projectId, action: "progress.upload", entityType: "ImportJob", entityId: job.id, after: { file: doc.originalName, error } });
  if (error) throw new UserError(error);
  return job.id;
}

export interface ProgressPreviewRow {
  rowNumber: number;
  itemId: string | null;
  code: string | null;
  name: string | null;
  unit: string | null;
  measurementType: "QUANTITY" | "PERCENT" | null;
  plannedQuantity: string | null;
  current: string | null;
  value: string | null;
  asOfDate: string | null;
  comment: string | null;
  errors: string[];
  warnings: string[];
  skip: boolean;
}

export async function loadProgressJob(projectId: string, jobId: string) {
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, projectId, kind: "PROGRESS" },
    include: { document: true, createdBy: { select: { name: true } } },
  });
  if (!job) return null;
  if (job.status !== "PARSED" || !job.document) return { job, rows: [] as ProgressPreviewRow[] };
  const sheets = await parseTabular(await readDocument(job.document.storagePath), job.document.originalName);
  const parsed = parseProgressSheet(sheets[0]);
  const data = await loadRegistry(projectId);
  const byId = new Map(data.rows.map((r) => [r.id, r]));
  const seen = new Map<string, number>();
  const today = new Date().toISOString().slice(0, 10);

  const rows: ProgressPreviewRow[] = parsed.rows.map((p) => {
    const item = p.itemId ? byId.get(p.itemId) : undefined;
    const errors = [...p.errors];
    const warnings: string[] = [];
    const skip = p.value === null && p.errors.length === 0;
    const current = item ? (item.measurementType === "QUANTITY" ? item.actualQuantity : item.percentRaw) : null;
    if (!skip) {
      if (p.itemId && !item) errors.push("Статья с таким ID не найдена в проекте");
      if (p.itemId) {
        if (seen.has(p.itemId)) errors.push(`Статья повторяется (строка ${seen.get(p.itemId)})`);
        else seen.set(p.itemId, p.rowNumber);
      }
      if (p.asOfDate && p.asOfDate > today) errors.push("Дата в будущем");
      const v = dec(p.value);
      if (item && v) {
        if (current !== null && v.lt(dec(current)!)) warnings.push("Новое значение меньше текущего (накопленный итог уменьшается)");
        if (item.measurementType === "QUANTITY" && item.plannedQuantity !== null && v.gt(dec(item.plannedQuantity)!))
          warnings.push("Превышение планового объёма — будет записано как неподтверждённое");
        if (item.measurementType === "PERCENT" && v.gt(100)) warnings.push("Процент больше 100 — превышение будет неподтверждённым");
      }
    }
    return {
      rowNumber: p.rowNumber,
      itemId: p.itemId,
      code: item?.code ?? null,
      name: item?.name ?? null,
      unit: item?.unit ?? null,
      measurementType: item?.measurementType ?? null,
      plannedQuantity: item?.plannedQuantity ?? null,
      current,
      value: p.value,
      asOfDate: p.asOfDate,
      comment: p.comment,
      errors,
      warnings,
      skip,
    };
  });
  return { job, rows };
}

/** Применение массового обновления: все строки или ни одной (одна транзакция). */
export async function confirmProgressImport(userId: string, projectId: string, jobId: string) {
  const loaded = await loadProgressJob(projectId, jobId);
  if (!loaded) throw new UserError("Импорт не найден");
  if (loaded.job.status !== "PARSED") throw new UserError("Импорт уже завершён или отменён");
  const toApply = loaded.rows.filter((r) => !r.skip);
  const errors = toApply.filter((r) => r.errors.length > 0);
  if (errors.length) throw new UserError(`Строк с ошибками: ${errors.length}. Исправьте файл и загрузите заново.`);
  if (toApply.length === 0) throw new UserError("В файле нет новых значений");

  await prisma.$transaction(
    async (tx) => {
      for (const r of toApply) {
        const prev = await tx.workProgressRecord.findFirst({
          where: { workItemId: r.itemId! },
          orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }],
        });
        await tx.workProgressRecord.create({
          data: {
            workItemId: r.itemId!,
            asOfDate: new Date(r.asOfDate! + "T00:00:00Z"),
            method: r.measurementType!,
            quantity: r.measurementType === "QUANTITY" ? r.value : null,
            percent: r.measurementType === "PERCENT" ? r.value : null,
            previousQuantity: prev?.quantity ?? null,
            previousPercent: prev?.percent ?? null,
            overrunConfirmed: false,
            comment: r.comment!,
            source: "EXCEL_IMPORT",
            importJobId: jobId,
            documentId: loaded.job.documentId,
            userId,
          },
        });
      }
      await tx.importJob.update({ where: { id: jobId }, data: { status: "CONFIRMED", finishedAt: new Date(), summary: { applied: toApply.length } } });
      await logAudit({ userId, projectId, action: "progress.bulkImport", entityType: "ImportJob", entityId: jobId, after: { applied: toApply.length } }, tx);
    },
    { timeout: 120_000 },
  );
  return toApply.length;
}
