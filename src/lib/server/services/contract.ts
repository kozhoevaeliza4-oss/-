import "server-only";
import { Prisma, ContractStatus, ContractSigningStatus } from "@prisma/client";
import { z } from "zod";
import { decimalField } from "../decimalField";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";
import { readDocument, saveUpload } from "../storage";
import { extractDocumentText } from "../docText";
import { parse } from "./project";
import { CONTRACT_FIELD_LABELS, extractContractFields } from "@/lib/extract/contract";
import { checkAllocationLimit, contractCurrentAmount } from "@/lib/calc/coverage";
import { dec } from "@/lib/calc/decimal";

export const CONTRACT_EXTENSIONS = ["pdf", "docx", "xlsx", "jpg", "jpeg", "png", "heic"];

const optStr = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? new Date(v + "T00:00:00Z") : null))
  .refine((d) => d === null || !isNaN(d.getTime()), "Некорректная дата");
const optDecimal = (label: string, dp: number, allowNegative = false) => decimalField(label, dp, { allowNegative });

/** Текущая сумма договора (исходная + подписанные доп. соглашения). */
export async function contractAmountNow(contractId: string) {
  const c = await prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: { amendments: true } });
  return contractCurrentAmount({
    totalAmount: dec(c.totalAmount),
    amendmentDeltas: c.amendments.filter((a) => a.isSigned).map((a) => dec(a.amountDelta)),
  });
}

/** Подрядчик по ИНН или точному наименованию; при отсутствии — создаётся (по явному вводу пользователя). */
async function resolveContractor(tx: Prisma.TransactionClient, name: string | null, inn: string | null) {
  if (inn) {
    const byInn = await tx.contractor.findUnique({ where: { inn } });
    if (byInn) return byInn.id;
  }
  if (!name) return null;
  const byName = await tx.contractor.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (byName) {
    if (inn && !byName.inn) await tx.contractor.update({ where: { id: byName.id }, data: { inn } });
    return byName.id;
  }
  return (await tx.contractor.create({ data: { name, inn } })).id;
}

// ───────────── Загрузка и извлечение ─────────────

/**
 * Загрузка договора: файл сохраняется, текст извлекается, найденные реквизиты записываются в договор
 * со статусом «загружен, требуется проверка» и источником каждого поля. Ничего не считается подтверждённым.
 */
export async function uploadContract(userId: string, projectId: string, file: File | null) {
  const doc = await saveUpload({ file, projectId, kind: "CONTRACT", userId, allowed: CONTRACT_EXTENSIONS });
  const dup = await prisma.contract.findFirst({ where: { projectId, document: { sha256: doc.sha256 }, NOT: { documentId: doc.id } } });
  let pages: { page: number; label: string; text: string }[] = [];
  let warnings: string[] = [];
  let extractionError: string | null = null;
  try {
    const r = await extractDocumentText(doc.buffer, doc.originalName);
    pages = r.pages;
    warnings = r.warnings;
  } catch (e) {
    extractionError = e instanceof Error ? e.message : "Не удалось извлечь текст";
  }
  const extracted = extractContractFields(pages);
  const get = (f: string) => extracted.find((e) => e.field === f)?.value ?? null;

  const contract = await prisma.$transaction(async (tx) => {
    const inn = get("contractorInn");
    // Подрядчик не создаётся автоматически — только подставляется существующий по ИНН
    const existing = inn ? await tx.contractor.findUnique({ where: { inn } }) : null;
    const c = await tx.contract.create({
      data: {
        projectId,
        documentId: doc.id,
        status: "UPLOADED_NEEDS_REVIEW",
        number: get("number"),
        date: get("date") ? new Date(get("date") + "T00:00:00Z") : null,
        subject: get("subject"),
        objectText: get("objectText"),
        totalAmount: get("totalAmount"),
        currency: get("currency"),
        startDate: get("startDate") ? new Date(get("startDate") + "T00:00:00Z") : null,
        endDate: get("endDate") ? new Date(get("endDate") + "T00:00:00Z") : null,
        paymentTerms: get("paymentTerms"),
        contractorInn: inn,
        contractorId: existing?.id ?? null,
        comment: [extractionError && `Ошибка извлечения текста: ${extractionError}`, ...warnings, dup && `Возможный дубликат: такой же файл уже загружен (договор № ${dup.number ?? "—"})`]
          .filter(Boolean)
          .join("\n") || null,
      },
    });
    for (const e of extracted) {
      await tx.extractedField.create({
        data: { documentId: doc.id, entityType: "Contract", entityId: c.id, field: e.field, value: e.value, location: e.pageLabel, fragment: e.fragment, needsReview: true },
      });
    }
    return c;
  });
  await logAudit({
    userId,
    projectId,
    action: "contract.upload",
    entityType: "Contract",
    entityId: contract.id,
    after: { file: doc.originalName, extracted: extracted.map((e) => e.field), pages: pages.length, warnings, extractionError },
  });
  return { contractId: contract.id, extractedCount: extracted.length, warnings: extractionError ? [extractionError, ...warnings] : warnings };
}

export async function contractDocumentText(projectId: string, contractId: string) {
  const c = await prisma.contract.findFirst({ where: { id: contractId, projectId }, include: { document: true } });
  if (!c?.document) return null;
  try {
    return await extractDocumentText(await readDocument(c.document.storagePath), c.document.originalName);
  } catch (e) {
    return { pages: [], warnings: [e instanceof Error ? e.message : "Ошибка чтения"] };
  }
}

// ───────────── Создание и редактирование ─────────────

export const contractSchema = z.object({
  contractorId: optStr(40),
  newContractorName: optStr(300),
  contractorInn: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{10,14}$/.test(v), "ИНН — 10–14 цифр"),
  number: optStr(100),
  date: optDate,
  subject: optStr(2000),
  objectText: optStr(500),
  totalAmount: optDecimal("Сумма договора", 2),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || /^[A-Z]{3}$/.test(v), "Валюта — код ISO из 3 букв"),
  startDate: optDate,
  endDate: optDate,
  paymentTerms: optStr(3000),
  signingStatus: z.nativeEnum(ContractSigningStatus).default("UNKNOWN"),
  comment: optStr(5000),
});

export async function createContract(userId: string, projectId: string, input: Record<string, string | undefined>) {
  const data = parse(contractSchema, input);
  const c = await prisma.$transaction(async (tx) => {
    const contractorId = data.contractorId ?? (await resolveContractor(tx, data.newContractorName, data.contractorInn));
    const { newContractorName: _n, ...rest } = data;
    void _n;
    return tx.contract.create({ data: { ...rest, contractorId, projectId, status: "UPLOADED_NEEDS_REVIEW" } });
  });
  await logAudit({ userId, projectId, action: "contract.create", entityType: "Contract", entityId: c.id, after: data });
  return c.id;
}

export async function updateContract(userId: string, projectId: string, contractId: string, input: Record<string, string | undefined>) {
  const data = parse(contractSchema, input);
  const before = await prisma.contract.findFirst({ where: { id: contractId, projectId } });
  if (!before) throw new UserError("Договор не найден");
  if (data.startDate && data.endDate && data.endDate < data.startDate) throw new UserError("Окончание раньше начала");
  await prisma.$transaction(async (tx) => {
    const contractorId = data.contractorId ?? (await resolveContractor(tx, data.newContractorName, data.contractorInn)) ?? before.contractorId;
    const { newContractorName: _n, ...rest } = data;
    void _n;
    await tx.contract.update({ where: { id: contractId }, data: { ...rest, contractorId } });
  });
  const changed = Object.fromEntries(
    Object.entries(data).filter(([k, v]) => k in before && String((before as Record<string, unknown>)[k] ?? "") !== String(v ?? "")),
  );
  await logAudit({
    userId,
    projectId,
    action: "contract.update",
    entityType: "Contract",
    entityId: contractId,
    before: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]])),
    after: changed,
  });
}

/** Подтверждение или отклонение извлечённого поля пользователем. */
export async function reviewExtractedField(userId: string, projectId: string, contractId: string, fieldId: string | "all") {
  const c = await prisma.contract.findFirst({ where: { id: contractId, projectId } });
  if (!c) throw new UserError("Договор не найден");
  const where = { entityType: "Contract", entityId: contractId, needsReview: true, ...(fieldId === "all" ? {} : { id: fieldId }) };
  const fields = await prisma.extractedField.findMany({ where });
  await prisma.extractedField.updateMany({ where, data: { needsReview: false, reviewedById: userId, reviewedAt: new Date() } });
  await logAudit({ userId, projectId, action: "contract.fieldsReviewed", entityType: "Contract", entityId: contractId, after: { fields: fields.map((f) => CONTRACT_FIELD_LABELS[f.field as keyof typeof CONTRACT_FIELD_LABELS] ?? f.field) } });
}

/**
 * Смена статуса действительности. «Действует»/«Завершён» — только после проверки:
 * указаны подрядчик, номер и дата, все извлечённые поля подтверждены.
 */
export async function setContractStatus(userId: string, projectId: string, contractId: string, status: ContractStatus, comment: string | null) {
  const c = await prisma.contract.findFirst({ where: { id: contractId, projectId } });
  if (!c) throw new UserError("Договор не найден");
  if (status === "ACTIVE" || status === "COMPLETED") {
    const missing = [!c.contractorId && "подрядчик", !c.number && "номер", !c.date && "дата"].filter(Boolean);
    if (missing.length) throw new UserError(`Нельзя подтвердить договор: не заполнено — ${missing.join(", ")}`);
    const pending = await prisma.extractedField.count({ where: { entityType: "Contract", entityId: contractId, needsReview: true } });
    if (pending) throw new UserError(`Есть непроверенные распознанные поля (${pending}). Проверьте и подтвердите их.`);
  }
  if ((status === "TERMINATED" || status === "NEEDS_CLARIFICATION") && !comment?.trim()) throw new UserError("Укажите основание");
  await prisma.contract.update({
    where: { id: contractId },
    data: { status, ...(status === "ACTIVE" ? { verifiedById: userId, verifiedAt: new Date() } : {}) },
  });
  await logAudit({ userId, projectId, action: "contract.status", entityType: "Contract", entityId: contractId, before: { status: c.status }, after: { status }, comment });
}

// ───────────── Дополнительные соглашения ─────────────

export const amendmentSchema = z.object({
  number: optStr(100),
  date: optDate,
  description: optStr(3000),
  amountDelta: optDecimal("Изменение суммы", 2, true),
  newEndDate: optDate,
  isSigned: z.boolean(),
});

export async function addAmendment(userId: string, projectId: string, contractId: string, input: z.input<typeof amendmentSchema>, file: File | null) {
  const data = parse(amendmentSchema, input);
  const c = await prisma.contract.findFirst({ where: { id: contractId, projectId } });
  if (!c) throw new UserError("Договор не найден");
  let documentId: string | null = null;
  if (file && typeof file !== "string" && file.size > 0) documentId = (await saveUpload({ file, projectId, kind: "AMENDMENT", userId, allowed: CONTRACT_EXTENSIONS })).id;
  const a = await prisma.contractAmendment.create({ data: { ...data, contractId, documentId } });
  if (data.isSigned && data.newEndDate) await prisma.contract.update({ where: { id: contractId }, data: { endDate: data.newEndDate } });
  await logAudit({ userId, projectId, action: "contract.amendment", entityType: "Contract", entityId: contractId, after: { amendmentId: a.id, ...data } });
}

export async function signAmendment(userId: string, projectId: string, amendmentId: string) {
  const a = await prisma.contractAmendment.findFirst({ where: { id: amendmentId, contract: { projectId } } });
  if (!a) throw new UserError("Доп. соглашение не найдено");
  await prisma.contractAmendment.update({ where: { id: amendmentId }, data: { isSigned: true } });
  if (a.newEndDate) await prisma.contract.update({ where: { id: a.contractId }, data: { endDate: a.newEndDate } });
  await logAudit({ userId, projectId, action: "contract.amendmentSigned", entityType: "Contract", entityId: a.contractId, after: { amendmentId } });
}

// ───────────── Распределение по статьям ─────────────

export const allocationSchema = z.object({
  workItemId: z.string().min(1, "Выберите статью"),
  quantity: optDecimal("Объём", 4),
  unitPrice: optDecimal("Цена", 4),
  amount: optDecimal("Сумма", 2),
  unit: optStr(40),
});

/** Создание или изменение распределения. Всегда в статусе «предложено» — подтверждается отдельно. */
export async function upsertAllocation(userId: string, projectId: string, contractId: string, input: Record<string, string | undefined>, source = "Ручной ввод") {
  const data = parse(allocationSchema, input);
  const c = await prisma.contract.findFirst({ where: { id: contractId, projectId } });
  if (!c) throw new UserError("Договор не найден");
  const item = await prisma.workItem.findFirst({ where: { id: data.workItemId, projectId } });
  if (!item) throw new UserError("Статья не найдена в проекте");
  let amount = data.amount;
  if (amount === null && data.quantity !== null && data.unitPrice !== null) amount = dec(data.quantity)!.times(dec(data.unitPrice)!).toFixed(2);
  if (amount !== null && data.quantity !== null && data.unitPrice !== null) {
    const calc = dec(data.quantity)!.times(dec(data.unitPrice)!);
    if (calc.minus(dec(amount)!).abs().gt(1)) throw new UserError(`Сумма (${amount}) не равна объёму × цене (${calc.toFixed(2)})`);
  }
  await assertLimit(contractId, data.workItemId, amount);
  const existing = await prisma.contractWorkAllocation.findUnique({ where: { contractId_workItemId: { contractId, workItemId: data.workItemId } } });
  const payload = { quantity: data.quantity, unitPrice: data.unitPrice, amount, unit: data.unit ?? item.unit, status: "PROPOSED" as const, source, confirmedById: null, confirmedAt: null };
  const saved = existing
    ? await prisma.contractWorkAllocation.update({ where: { id: existing.id }, data: payload })
    : await prisma.contractWorkAllocation.create({ data: { ...payload, contractId, workItemId: data.workItemId } });
  await logAudit({
    userId,
    projectId,
    action: existing ? "allocation.update" : "allocation.create",
    entityType: "ContractWorkAllocation",
    entityId: saved.id,
    before: existing ? { quantity: existing.quantity, amount: existing.amount, status: existing.status } : null,
    after: { contractId, workItemId: data.workItemId, quantity: data.quantity, amount },
  });
}

/**
 * Лимит распределения. При создании предложения учитываются все неотклонённые распределения,
 * при подтверждении — только уже подтверждённые (предложения не являются обязательствами).
 */
async function assertLimit(contractId: string, workItemId: string, newAmount: string | null, mode: "propose" | "confirm" = "propose") {
  const c = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  const others = await prisma.contractWorkAllocation.findMany({
    where: { contractId, status: mode === "confirm" ? "CONFIRMED" : { not: "REJECTED" }, NOT: { workItemId } },
  });
  const current = await contractAmountNow(contractId);
  const r = checkAllocationLimit({
    contractAmount: current.value,
    otherAllocations: others.map((o) => dec(o.amount)),
    newAmount: dec(newAmount),
    overAllocationAllowed: c.overAllocationAllowed,
  });
  if (!r.ok) throw new UserError(r.reason!);
}

export async function setAllocationStatus(userId: string, projectId: string, allocationId: string, status: "CONFIRMED" | "REJECTED" | "DELETE") {
  const a = await prisma.contractWorkAllocation.findFirst({ where: { id: allocationId, contract: { projectId } } });
  if (!a) throw new UserError("Распределение не найдено");
  if (status === "DELETE") {
    await prisma.contractWorkAllocation.delete({ where: { id: allocationId } });
  } else {
    if (status === "CONFIRMED") await assertLimit(a.contractId, a.workItemId, a.amount?.toString() ?? null, "confirm");
    await prisma.contractWorkAllocation.update({
      where: { id: allocationId },
      data: { status, confirmedById: status === "CONFIRMED" ? userId : null, confirmedAt: status === "CONFIRMED" ? new Date() : null },
    });
  }
  await logAudit({ userId, projectId, action: `allocation.${status.toLowerCase()}`, entityType: "ContractWorkAllocation", entityId: allocationId, before: { status: a.status, amount: a.amount } });
}

/** Исключение: разрешить распределить больше суммы договора (с обязательным обоснованием). */
export async function setOverAllocation(userId: string, projectId: string, contractId: string, allowed: boolean, comment: string | null) {
  const c = await prisma.contract.findFirst({ where: { id: contractId, projectId } });
  if (!c) throw new UserError("Договор не найден");
  if (allowed && !comment?.trim()) throw new UserError("Укажите обоснование исключения");
  await prisma.contract.update({
    where: { id: contractId },
    data: { overAllocationAllowed: allowed, overAllocationComment: allowed ? comment : null, overAllocationById: allowed ? userId : null },
  });
  await logAudit({ userId, projectId, action: "contract.overAllocation", entityType: "Contract", entityId: contractId, after: { allowed }, comment });
}
