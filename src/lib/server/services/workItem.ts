import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decimalField, parseUserDecimal } from "../decimalField";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";
import { saveUpload } from "../storage";
import { parse } from "./project";
import { dec } from "@/lib/calc/decimal";

const optStr = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? new Date(v + "T00:00:00Z") : null))
  .refine((d) => d === null || !isNaN(d.getTime()), "Некорректная дата");
const optMoney = decimalField("Сумма", 2);

/** Поля статьи, которые разрешено редактировать вручную. Плановые значения меняются только через версии сметы. */
export const workItemEditSchema = z.object({
  objectId: optStr(40),
  stageId: optStr(40),
  measurementType: z.enum(["QUANTITY", "PERCENT"]),
  plannedStartDate: optDate,
  plannedEndDate: optDate,
  actualEndDate: optDate,
  comment: optStr(5000),
  forecastRemainingCost: optMoney,
  forecastNote: optStr(2000),
});

export async function updateWorkItem(userId: string, projectId: string, itemId: string, input: Record<string, string | undefined>) {
  const data = parse(workItemEditSchema, input);
  const before = await prisma.workItem.findFirst({ where: { id: itemId, projectId } });
  if (!before) throw new UserError("Статья не найдена");
  if (data.objectId && !(await prisma.constructionObject.findFirst({ where: { id: data.objectId, projectId } })))
    throw new UserError("Корпус не найден");
  if (data.stageId && !(await prisma.constructionStage.findFirst({ where: { id: data.stageId, projectId } })))
    throw new UserError("Этап не найден");
  if (data.plannedStartDate && data.plannedEndDate && data.plannedEndDate < data.plannedStartDate)
    throw new UserError("Плановая дата завершения раньше даты начала");
  await prisma.workItem.update({ where: { id: itemId }, data });
  const changed = Object.fromEntries(
    Object.entries(data).filter(([k, v]) => String((before as Record<string, unknown>)[k] ?? "") !== String(v ?? "")),
  );
  if (Object.keys(changed).length) {
    await logAudit({
      userId,
      projectId,
      action: "workItem.update",
      entityType: "WorkItem",
      entityId: itemId,
      before: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]])),
      after: changed,
    });
  }
}

export const manualItemSchema = z.object({
  code: optStr(100),
  name: z.string().trim().min(1, "Укажите наименование").max(1000),
  unit: optStr(40),
  objectId: optStr(40),
  stageId: optStr(40),
  measurementType: z.enum(["QUANTITY", "PERCENT"]),
  comment: z.string().trim().min(1, "Укажите основание добавления статьи").max(5000),
});

/** Статья, добавленная вручную (не из сметы). Плановой стоимости не имеет, пока не появится в утверждённой смете. */
export async function createManualWorkItem(userId: string, projectId: string, input: Record<string, string | undefined>) {
  const data = parse(manualItemSchema, input);
  const item = await prisma.workItem.create({
    data: { ...data, projectId, origin: "MANUAL", itemKey: `manual:${randomUUID()}`, createdById: userId },
  });
  await logAudit({ userId, projectId, action: "workItem.createManual", entityType: "WorkItem", entityId: item.id, after: data });
  return item.id;
}

// ───────────── Физическое выполнение ─────────────

export interface ProgressInput {
  asOfDate: string | undefined;
  quantity?: string | undefined;
  percent?: string | undefined;
  overrunConfirmed?: boolean;
  comment: string | undefined;
}

function parseDecimalInput(v: string | undefined, label: string): string | null {
  if (v === undefined || v.trim() === "") return null;
  // Отрицательное значение пропускается сюда и отклоняется ниже с предметным сообщением
  const r = parseUserDecimal(v, { dp: 4, allowNegative: true });
  if ("error" in r) throw new UserError(r.error === "range" ? `${label}: слишком большое значение` : `${label}: введите число`);
  return dec(r.value)!.toString();
}

/**
 * Новая запись физического выполнения. Предыдущие записи не изменяются — история сохраняется полностью.
 * Значение — накопленный итог на дату (а не прирост).
 */
export async function recordProgress(
  userId: string,
  projectId: string,
  itemId: string,
  input: ProgressInput,
  opts: { canConfirmOverrun: boolean; source?: "MANUAL" | "EXCEL_IMPORT"; importJobId?: string; file?: File | null } = { canConfirmOverrun: false },
) {
  const item = await prisma.workItem.findFirst({ where: { id: itemId, projectId } });
  if (!item) throw new UserError("Статья не найдена");
  const comment = input.comment?.trim();
  if (!comment) throw new UserError("Укажите комментарий (основание изменения)", { comment: "Обязательное поле" });
  const asOfDate = input.asOfDate ? new Date(input.asOfDate + "T00:00:00Z") : null;
  if (!asOfDate || isNaN(asOfDate.getTime())) throw new UserError("Укажите дату, на которую зафиксировано выполнение");
  if (asOfDate.getTime() > Date.now() + 24 * 3600 * 1000) throw new UserError("Дата выполнения не может быть в будущем");

  let quantity: string | null = null;
  let percent: string | null = null;
  if (item.measurementType === "QUANTITY") {
    quantity = parseDecimalInput(input.quantity, "Фактический объём");
    if (quantity === null) throw new UserError("Укажите фактический объём (накопленным итогом)");
    if (dec(quantity)!.isNegative()) throw new UserError("Фактический объём не может быть отрицательным");
  } else {
    percent = parseDecimalInput(input.percent, "Процент готовности");
    if (percent === null) throw new UserError("Укажите процент готовности");
    const p = dec(percent)!;
    if (p.isNegative()) throw new UserError("Процент не может быть отрицательным");
    // Превышение 100 % допустимо (подтверждается отдельно), но не произвольное число — колонка Decimal(9, 4)
    if (p.gt(1000)) throw new UserError("Процент готовности не может превышать 1000 %");
  }

  // Превышение плана: подтвердить может только пользователь с соответствующим правом
  const active = await prisma.estimateVersion.findFirst({ where: { projectId, status: "ACTIVE" } });
  const line = active ? await prisma.estimateLine.findFirst({ where: { versionId: active.id, workItemId: itemId } }) : null;
  const planned = dec(line?.quantity);
  const exceeds =
    (quantity !== null && planned !== null && dec(quantity)!.gt(planned)) || (percent !== null && dec(percent)!.gt(100));
  const overrunConfirmed = exceeds && !!input.overrunConfirmed;
  if (overrunConfirmed && !opts.canConfirmOverrun) throw new UserError("Нет права подтверждать превышение планового объёма");

  const prev = await prisma.workProgressRecord.findFirst({
    where: { workItemId: itemId },
    orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }],
  });

  let documentId: string | null = null;
  if (opts.file && typeof opts.file !== "string" && opts.file.size > 0) {
    const doc = await saveUpload({ file: opts.file, projectId, kind: "PROGRESS", userId, allowed: ["pdf", "jpg", "jpeg", "png", "xlsx", "docx"] });
    documentId = doc.id;
  }

  const rec = await prisma.workProgressRecord.create({
    data: {
      workItemId: itemId,
      asOfDate,
      method: item.measurementType,
      quantity,
      percent,
      previousQuantity: prev?.quantity ?? null,
      previousPercent: prev?.percent ?? null,
      overrunConfirmed,
      comment,
      source: opts.source ?? "MANUAL",
      importJobId: opts.importJobId ?? null,
      documentId,
      userId,
    },
  });
  await logAudit({
    userId,
    projectId,
    action: "progress.record",
    entityType: "WorkItem",
    entityId: itemId,
    before: prev ? { quantity: prev.quantity, percent: prev.percent, asOfDate: prev.asOfDate } : null,
    after: { quantity, percent, asOfDate, overrunConfirmed, recordId: rec.id },
    comment,
  });
  return { record: rec, exceedsUnconfirmed: exceeds && !overrunConfirmed };
}
