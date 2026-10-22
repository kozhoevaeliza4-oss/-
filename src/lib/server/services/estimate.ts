import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";
import { readDocument, saveUpload } from "../storage";
import { ParseError, parseTabular, Sheet } from "@/lib/import/tabular";
import {
  buildEstimatePreview,
  diffVersions,
  DiffLineInput,
  ESTIMATE_FIELDS,
  EstimateMapping,
  EstimatePreview,
  guessEstimateMapping,
  normKey,
} from "@/lib/import/estimate";
import { dec } from "@/lib/calc/decimal";
import { plannedCost } from "@/lib/calc/workItem";

export const ESTIMATE_EXTENSIONS = ["xlsx", "xlsm", "csv"];

interface EstimateJobMapping {
  estimate: EstimateMapping;
  meta: { name: string; notes: string | null };
}

export async function startEstimateImport(
  userId: string,
  projectId: string,
  input: { file: File | null; name: string; notes: string | null; allowDuplicate: boolean },
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new UserError("Укажите название версии сметы", { name: "Укажите название" });
  if (input.file && typeof input.file !== "string" && input.file.size > 0) {
    const sha = createHash("sha256").update(Buffer.from(await input.file.arrayBuffer())).digest("hex");
    const prev = await prisma.importJob.findFirst({
      where: { projectId, kind: "ESTIMATE", status: { in: ["PARSED", "CONFIRMED"] }, document: { sha256: sha } },
      include: { estimateVersion: true },
      orderBy: { createdAt: "desc" },
    });
    if (prev && !input.allowDuplicate) {
      throw new UserError(
        `Этот файл уже загружался ${prev.createdAt.toLocaleDateString("ru-RU")}` +
          (prev.estimateVersion ? ` (версия ${prev.estimateVersion.versionNumber} «${prev.estimateVersion.name}»)` : "") +
          ". Если загрузка повторная намеренно — отметьте «Загрузить повторно».",
      );
    }
  }

  const doc = await saveUpload({ file: input.file, projectId, kind: "ESTIMATE", userId, allowed: ESTIMATE_EXTENSIONS });
  let sheets: Sheet[];
  try {
    sheets = await parseTabular(doc.buffer, doc.originalName);
  } catch (e) {
    const message = e instanceof ParseError ? e.message : "Не удалось разобрать файл";
    await prisma.importJob.create({
      data: { projectId, kind: "ESTIMATE", status: "FAILED", documentId: doc.id, error: message, createdById: userId, finishedAt: new Date() },
    });
    throw new UserError(message);
  }
  const mapping: EstimateJobMapping = { estimate: guessEstimateMapping(sheets), meta: { name, notes: input.notes } };
  const job = await prisma.importJob.create({
    data: {
      projectId,
      kind: "ESTIMATE",
      status: "PARSED",
      documentId: doc.id,
      mapping: mapping as unknown as Prisma.InputJsonValue,
      createdById: userId,
    },
  });
  await logAudit({
    userId,
    projectId,
    action: "estimate.upload",
    entityType: "ImportJob",
    entityId: job.id,
    after: { file: doc.originalName, sha256: doc.sha256, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })) },
  });
  return job.id;
}

export async function loadEstimateJob(projectId: string, jobId: string) {
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, projectId, kind: "ESTIMATE" },
    include: { document: true, estimateVersion: true, createdBy: { select: { name: true } } },
  });
  if (!job) return null;
  const m = job.mapping as unknown as EstimateJobMapping | null;
  let sheets: Sheet[] = [];
  let preview: EstimatePreview | null = null;
  let parseError: string | null = job.error;
  if (job.document && job.status === "PARSED" && m) {
    try {
      sheets = await parseTabular(await readDocument(job.document.storagePath), job.document.originalName);
      preview = buildEstimatePreview(sheets, m.estimate);
    } catch (e) {
      parseError = e instanceof Error ? e.message : "Ошибка чтения файла";
    }
  }
  return { job, mapping: m, sheets, preview, parseError };
}

const mappingSchema = z.object({
  sheetIndex: z.coerce.number().int().min(0),
  headerRow: z.coerce.number().int().min(1),
  sectionMode: z.enum(["column", "header-rows", "none"]),
  keyMode: z.enum(["code_name", "code", "lineNo"]),
  defaultObjectCode: z.string().trim().optional().transform((v) => v || null),
  defaultStageCode: z.string().trim().optional().transform((v) => v || null),
});

export async function updateEstimateMapping(userId: string, projectId: string, jobId: string, form: Record<string, string | undefined>) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, projectId, kind: "ESTIMATE" } });
  if (!job) throw new UserError("Импорт не найден");
  if (job.status !== "PARSED") throw new UserError("Импорт уже завершён или отменён");
  const r = mappingSchema.safeParse(form);
  if (!r.success) throw new UserError("Некорректные параметры сопоставления");
  const columns: EstimateMapping["columns"] = {};
  for (const f of Object.keys(ESTIMATE_FIELDS) as (keyof typeof ESTIMATE_FIELDS)[]) {
    const v = form[`col_${f}`];
    if (v !== undefined && v !== "") {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0) columns[f] = n;
    }
  }
  const prev = job.mapping as unknown as EstimateJobMapping;
  const next: EstimateJobMapping = { ...prev, estimate: { ...r.data, columns } };
  await prisma.importJob.update({ where: { id: jobId }, data: { mapping: next as unknown as Prisma.InputJsonValue } });
  void userId;
}

/** Подтверждение импорта: создаёт ЧЕРНОВИК версии сметы. Реестр не меняется до утверждения версии. */
export async function confirmEstimateImport(userId: string, projectId: string, jobId: string): Promise<string> {
  const loaded = await loadEstimateJob(projectId, jobId);
  if (!loaded) throw new UserError("Импорт не найден");
  const { job, mapping, preview, parseError } = loaded;
  if (job.status !== "PARSED") throw new UserError("Импорт уже завершён или отменён");
  if (!preview || !mapping) throw new UserError(parseError ?? "Нет данных предпросмотра");
  if (preview.mappingErrors.length) throw new UserError(preview.mappingErrors[0]);
  if (preview.errorCount > 0) throw new UserError(`В данных ${preview.errorCount} ошибок. Исправьте сопоставление или файл.`);
  if (preview.lines.length === 0) throw new UserError("Не найдено ни одной строки работ");

  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const versionId = await prisma.$transaction(async (tx) => {
    const last = await tx.estimateVersion.findFirst({ where: { projectId }, orderBy: { versionNumber: "desc" } });
    const version = await tx.estimateVersion.create({
      data: {
        projectId,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        name: mapping.meta.name,
        notes: mapping.meta.notes,
        status: "DRAFT",
        currency: project.currency,
        documentId: job.documentId,
        importJobId: job.id,
        createdById: userId,
      },
    });
    await tx.estimateLine.createMany({
      data: preview.lines.map((l) => ({
        versionId: version.id,
        itemKey: l.itemKey,
        lineNo: l.lineNo,
        code: l.code,
        name: l.name,
        unit: l.unit,
        sectionCode: l.sectionCode,
        sectionName: l.sectionName,
        objectCode: l.objectCode,
        stageCode: l.stageCode,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        sourceTotal: l.total,
        currency: project.currency,
        sourceSheet: preview.sheetName,
        sourceRow: l.rowNumber,
      })),
    });
    const summary = {
      lines: preview.lines.length,
      skipped: preview.skipped.length,
      warnings: preview.warningCount,
      totalPlanned: preview.totalPlanned,
      linesWithoutCost: preview.linesWithoutCost,
      fileTotals: preview.fileTotals,
      versionNumber: version.versionNumber,
    };
    await tx.importJob.update({ where: { id: job.id }, data: { status: "CONFIRMED", finishedAt: new Date(), summary: summary as unknown as Prisma.InputJsonValue } });
    await logAudit({ userId, projectId, action: "estimate.importConfirmed", entityType: "EstimateVersion", entityId: version.id, after: summary }, tx);
    return version.id;
  });
  return versionId;
}

export async function cancelImportJob(userId: string, projectId: string, jobId: string) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, projectId } });
  if (!job) throw new UserError("Импорт не найден");
  if (job.status !== "PARSED") throw new UserError("Импорт уже завершён");
  await prisma.importJob.update({ where: { id: jobId }, data: { status: "CANCELLED", finishedAt: new Date() } });
  await logAudit({ userId, projectId, action: "import.cancel", entityType: "ImportJob", entityId: jobId });
}

// ───────────── Версии ─────────────

export async function versionDiffLines(versionId: string): Promise<DiffLineInput[]> {
  const lines = await prisma.estimateLine.findMany({ where: { versionId }, orderBy: { sourceRow: "asc" } });
  return lines.map((l) => ({
    itemKey: l.itemKey,
    code: l.code,
    name: l.name,
    unit: l.unit,
    quantity: l.quantity?.toString() ?? null,
    unitPrice: l.unitPrice?.toString() ?? null,
    plannedCost: plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) }).value?.toFixed(2) ?? null,
  }));
}

export async function compareVersions(beforeId: string | null, afterId: string) {
  const [before, after] = await Promise.all([beforeId ? versionDiffLines(beforeId) : Promise.resolve([]), versionDiffLines(afterId)]);
  return diffVersions(before, after);
}

/**
 * Утверждение версии: строки связываются со статьями реестра (по ключу), недостающие статьи,
 * разделы, корпуса и этапы создаются. Предыдущая версия сохраняется как история (SUPERSEDED).
 */
export async function approveVersion(userId: string, projectId: string, versionId: string, comment: string | null) {
  const version = await prisma.estimateVersion.findFirst({ where: { id: versionId, projectId } });
  if (!version) throw new UserError("Версия не найдена");
  if (version.status !== "DRAFT") throw new UserError("Утвердить можно только черновик версии");
  const active = await prisma.estimateVersion.findFirst({ where: { projectId, status: "ACTIVE" } });
  const diff = await compareVersions(active?.id ?? null, versionId);

  await prisma.$transaction(
    async (tx) => {
      const lines = await tx.estimateLine.findMany({ where: { versionId } });

      // Корпуса
      const objects = await tx.constructionObject.findMany({ where: { projectId } });
      const objectIdByRef = new Map<string, string>();
      for (const o of objects) {
        objectIdByRef.set(normKey(o.code), o.id);
        if (!objectIdByRef.has(normKey(o.name))) objectIdByRef.set(normKey(o.name), o.id);
      }
      for (const ref of new Set(lines.map((l) => l.objectCode).filter((x): x is string => !!x))) {
        if (objectIdByRef.has(normKey(ref))) continue;
        const o = await tx.constructionObject.create({ data: { projectId, code: ref.slice(0, 40), name: ref } });
        objectIdByRef.set(normKey(ref), o.id);
      }
      // Этапы
      const stages = await tx.constructionStage.findMany({ where: { projectId } });
      const stageIdByRef = new Map<string, string>();
      for (const s of stages) {
        stageIdByRef.set(normKey(s.code), s.id);
        if (!stageIdByRef.has(normKey(s.name))) stageIdByRef.set(normKey(s.name), s.id);
      }
      for (const ref of new Set(lines.map((l) => l.stageCode).filter((x): x is string => !!x))) {
        if (stageIdByRef.has(normKey(ref))) continue;
        const s = await tx.constructionStage.create({ data: { projectId, code: ref.slice(0, 40), name: ref } });
        stageIdByRef.set(normKey(ref), s.id);
      }
      // Разделы
      const sections = await tx.estimateSection.findMany({ where: { projectId } });
      const sectionIdByCode = new Map(sections.map((s) => [s.code, s.id]));
      let order = sections.length;
      for (const l of lines) {
        if (!l.sectionCode || sectionIdByCode.has(l.sectionCode)) continue;
        const s = await tx.estimateSection.create({
          data: { projectId, code: l.sectionCode, name: l.sectionName ?? l.sectionCode, sortOrder: ++order },
        });
        sectionIdByCode.set(l.sectionCode, s.id);
      }
      // Статьи
      const items = await tx.workItem.findMany({ where: { projectId }, select: { id: true, itemKey: true } });
      const itemByKey = new Map(items.map((i) => [i.itemKey, i.id]));
      for (const l of lines) {
        const data = {
          code: l.code,
          name: l.name,
          unit: l.unit,
          sectionId: l.sectionCode ? sectionIdByCode.get(l.sectionCode)! : null,
          objectId: l.objectCode ? objectIdByRef.get(normKey(l.objectCode))! : null,
          stageId: l.stageCode ? stageIdByRef.get(normKey(l.stageCode))! : null,
        };
        let workItemId = itemByKey.get(l.itemKey);
        if (workItemId) {
          await tx.workItem.update({ where: { id: workItemId }, data });
        } else {
          const wi = await tx.workItem.create({ data: { ...data, projectId, itemKey: l.itemKey, origin: "ESTIMATE", createdById: userId } });
          workItemId = wi.id;
          itemByKey.set(l.itemKey, wi.id);
        }
        await tx.estimateLine.update({ where: { id: l.id }, data: { workItemId, sectionId: data.sectionId } });
      }

      if (active) await tx.estimateVersion.update({ where: { id: active.id }, data: { status: "SUPERSEDED" } });
      const hasBaseline = await tx.estimateVersion.count({ where: { projectId, isBaseline: true } });
      await tx.estimateVersion.update({
        where: { id: versionId },
        data: { status: "ACTIVE", approvedAt: new Date(), approvedById: userId, isBaseline: hasBaseline === 0 },
      });
      await logAudit(
        {
          userId,
          projectId,
          action: "estimate.approve",
          entityType: "EstimateVersion",
          entityId: versionId,
          before: active ? { activeVersion: active.versionNumber, total: diff.totalBefore } : null,
          after: {
            versionNumber: version.versionNumber,
            total: diff.totalAfter,
            added: diff.added,
            removed: diff.removed,
            changed: diff.changed,
            baseline: hasBaseline === 0,
          },
          comment,
        },
        tx,
      );
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

export async function rejectVersion(userId: string, projectId: string, versionId: string, reason: string | null) {
  const version = await prisma.estimateVersion.findFirst({ where: { id: versionId, projectId } });
  if (!version) throw new UserError("Версия не найдена");
  if (version.status !== "DRAFT") throw new UserError("Отклонить можно только черновик");
  if (!reason?.trim()) throw new UserError("Укажите причину отклонения");
  await prisma.estimateVersion.update({ where: { id: versionId }, data: { status: "REJECTED" } });
  await logAudit({ userId, projectId, action: "estimate.reject", entityType: "EstimateVersion", entityId: versionId, comment: reason });
}
