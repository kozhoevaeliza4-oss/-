import "server-only";
import { ActStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";
import { parse } from "./project";
import { contractAmountNow } from "./contract";
import { dec, Decimal, Num, sumKnown } from "@/lib/calc/decimal";
import { checkActLimits, LimitViolation } from "@/lib/calc/actLimits";
import { plannedCost } from "@/lib/calc/workItem";
import { looseDocKey } from "@/lib/extract/normalize";

const optStr = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? new Date(v.slice(0, 10) + "T00:00:00Z") : null))
  .refine((d) => d === null || !isNaN(d.getTime()), "Некорректная дата");
const decStr = (label: string, dp: number) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || String(v).trim() === "") return null;
      const d = dec(String(v).replace(/[\s ]/g, "").replace(",", "."));
      if (d === null) {
        ctx.addIssue({ code: "custom", message: `${label}: введите число` });
        return z.NEVER;
      }
      return d.toFixed(dp);
    });

export const actHeaderSchema = z.object({
  number: z.string().trim().min(1, "Укажите номер акта").max(100),
  date: z
    .string()
    .trim()
    .min(1, "Укажите дату акта")
    .transform((v) => new Date(v.slice(0, 10) + "T00:00:00Z"))
    .refine((d) => !isNaN(d.getTime()), "Некорректная дата"),
  periodFrom: optDate,
  periodTo: optDate,
  contractId: optStr(40),
  contractorId: optStr(40),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Валюта — код из 3 букв"),
  customerName: optStr(300),
  contractorName: optStr(300),
  contractorInn: optStr(20),
  contractText: optStr(300),
  objectText: optStr(500),
  documentTotal: decStr("Итог по документу", 2),
  vatAmount: decStr("НДС", 2),
  amountInWords: optStr(500),
  signatories: optStr(1000),
  comment: optStr(5000),
});

export const allocationInputSchema = z.object({
  workItemId: z.string().min(1),
  quantity: decStr("Объём распределения", 4),
  amount: decStr("Сумма распределения", 2).refine((v) => v !== null, "Укажите сумму распределения"),
});

export const actLineSchema = z.object({
  lineNo: optStr(20),
  code: optStr(100),
  description: z.string().trim().min(1, "Укажите наименование работы в строке").max(2000),
  unit: optStr(40),
  quantity: decStr("Количество", 4),
  unitPrice: decStr("Цена", 4),
  amount: decStr("Сумма строки", 2).refine((v) => v !== null, "Укажите сумму строки"),
  directCosts: decStr("Прямые затраты", 2),
  note: optStr(1000),
  pageNumber: z.number().int().nullish().transform((v) => v ?? null),
  allocations: z.array(allocationInputSchema).default([]),
});

export type ActHeaderInput = z.input<typeof actHeaderSchema>;
export type ActLineInput = z.input<typeof actLineSchema>;

const EDITABLE: ActStatus[] = ["DRAFT", "ON_APPROVAL", "REJECTED"];

async function validateRefs(tx: Prisma.TransactionClient, projectId: string, h: z.output<typeof actHeaderSchema>, lines: z.output<typeof actLineSchema>[]) {
  let contractorId = h.contractorId;
  if (h.contractId) {
    const c = await tx.contract.findFirst({ where: { id: h.contractId, projectId } });
    if (!c) throw new UserError("Договор не найден в проекте");
    if (contractorId && c.contractorId && c.contractorId !== contractorId) throw new UserError("Подрядчик акта не совпадает с подрядчиком договора");
    contractorId = contractorId ?? c.contractorId;
  }
  if (contractorId && !(await tx.contractor.findUnique({ where: { id: contractorId } }))) throw new UserError("Подрядчик не найден");
  const itemIds = [...new Set(lines.flatMap((l) => l.allocations.map((a) => a.workItemId)))];
  if (itemIds.length) {
    const n = await tx.workItem.count({ where: { id: { in: itemIds }, projectId } });
    if (n !== itemIds.length) throw new UserError("Часть статей не найдена в проекте");
  }
  lines.forEach((l, i) => {
    const sum = sumKnown(l.allocations.map((a) => dec(a.amount))).sum ?? new Decimal(0);
    const amt = dec(l.amount)!;
    if (sum.abs().gt(amt.abs().plus("0.01"))) throw new UserError(`Строка ${i + 1}: сумма распределения (${sum.toFixed(2)}) больше суммы строки (${amt.toFixed(2)})`);
    if (new Set(l.allocations.map((a) => a.workItemId)).size !== l.allocations.length) throw new UserError(`Строка ${i + 1}: статья указана дважды`);
  });
  return contractorId;
}

async function writeLines(tx: Prisma.TransactionClient, actId: string, lines: z.output<typeof actLineSchema>[]) {
  await tx.actLine.deleteMany({ where: { actId } });
  for (const [i, l] of lines.entries()) {
    const { allocations, ...rest } = l;
    await tx.actLine.create({
      data: {
        ...rest,
        actId,
        sortOrder: i,
        amount: rest.amount!,
        unmatched: allocations.length === 0,
        allocations: { create: allocations.map((a) => ({ workItemId: a.workItemId, quantity: a.quantity, amount: a.amount! })) },
      },
    });
  }
}

export async function createAct(
  userId: string,
  projectId: string,
  headerIn: Record<string, unknown>,
  linesIn: unknown[],
  opts: { documentId?: string | null; correctsActId?: string | null; duplicateDecision?: string | null; status?: "DRAFT" | "ON_APPROVAL"; tx?: Prisma.TransactionClient } = {},
): Promise<string> {
  const h = parse(actHeaderSchema, headerIn);
  const lines = linesIn.map((l, i) => {
    try {
      return parse(actLineSchema, l);
    } catch (e) {
      throw new UserError(`Строка ${i + 1}: ${e instanceof Error ? e.message : e}`);
    }
  });
  if (lines.length === 0) throw new UserError("В акте нет ни одной строки");
  const run = async (tx: Prisma.TransactionClient) => {
    const contractorId = await validateRefs(tx, projectId, h, lines);
    if (opts.correctsActId) {
      const orig = await tx.act.findFirst({ where: { id: opts.correctsActId, projectId } });
      if (!orig || orig.status !== "SIGNED") throw new UserError("Корректировать можно только подписанный акт");
    }
    const act = await tx.act.create({
      data: {
        ...h,
        contractorId,
        projectId,
        status: opts.status ?? "DRAFT",
        statusChangedAt: new Date(),
        isCorrection: !!opts.correctsActId,
        correctsActId: opts.correctsActId ?? null,
        documentId: opts.documentId ?? null,
        duplicateDecision: opts.duplicateDecision ?? null,
        createdById: userId,
      },
    });
    await writeLines(tx, act.id, lines);
    await logAudit({ userId, projectId, action: opts.correctsActId ? "act.createCorrection" : "act.create", entityType: "Act", entityId: act.id, after: { number: h.number, lines: lines.length, total: totalOf(lines) } }, tx);
    return act.id;
  };
  return opts.tx ? run(opts.tx) : prisma.$transaction(run, { timeout: 60_000 });
}

function totalOf(lines: { amount: string | null }[]) {
  return sumKnown(lines.map((l) => dec(l.amount))).sum?.toFixed(2) ?? null;
}

export async function updateAct(userId: string, projectId: string, actId: string, headerIn: Record<string, unknown>, linesIn: unknown[]) {
  const act = await prisma.act.findFirst({ where: { id: actId, projectId }, include: { lines: true } });
  if (!act) throw new UserError("Акт не найден");
  if (!EDITABLE.includes(act.status)) throw new UserError("Подписанный, скорректированный или аннулированный акт не редактируется. Создайте корректировочный акт.");
  const h = parse(actHeaderSchema, headerIn);
  const lines = linesIn.map((l, i) => {
    try {
      return parse(actLineSchema, l);
    } catch (e) {
      throw new UserError(`Строка ${i + 1}: ${e instanceof Error ? e.message : e}`);
    }
  });
  if (lines.length === 0) throw new UserError("В акте нет ни одной строки");
  await prisma.$transaction(async (tx) => {
    const contractorId = await validateRefs(tx, projectId, h, lines);
    await tx.act.update({ where: { id: actId }, data: { ...h, contractorId } });
    await writeLines(tx, actId, lines);
    await logAudit(
      {
        userId,
        projectId,
        action: "act.update",
        entityType: "Act",
        entityId: actId,
        before: { number: act.number, total: totalOf(act.lines.map((l) => ({ amount: l.amount.toString() }))), lines: act.lines.length },
        after: { number: h.number, total: totalOf(lines), lines: lines.length },
      },
      tx,
    );
  });
}

// ───────────── Контроль лимитов и дубликатов ─────────────

export async function actLimitViolations(projectId: string, actId: string): Promise<LimitViolation[]> {
  const act = await prisma.act.findFirstOrThrow({
    where: { id: actId, projectId },
    include: { lines: { include: { allocations: { include: { workItem: true } } } } },
  });
  const actTotal = sumKnown(act.lines.map((l) => dec(l.amount))).sum;
  const allocations = act.lines.flatMap((l) =>
    l.allocations.map((a) => ({ workItemId: a.workItemId, label: `${a.workItem.code ?? ""} ${a.workItem.name}`.trim(), quantity: dec(a.quantity), amount: dec(a.amount) })),
  );
  const itemIds = [...new Set(allocations.map((a) => a.workItemId))];
  const exclude = [act.id, ...(act.correctsActId ? [act.correctsActId] : [])];
  const [contractAmount, contractAllocs, otherSignedContract, otherAllocs, active] = await Promise.all([
    act.contractId ? contractAmountNow(act.contractId) : Promise.resolve({ value: null as Num, incomplete: true }),
    act.contractId ? prisma.contractWorkAllocation.findMany({ where: { contractId: act.contractId, status: "CONFIRMED" } }) : Promise.resolve([]),
    act.contractId
      ? prisma.actLine.findMany({ where: { act: { contractId: act.contractId, status: "SIGNED", id: { notIn: exclude }, currency: act.currency } }, select: { amount: true } })
      : Promise.resolve([]),
    prisma.actLineAllocation.findMany({
      where: { workItemId: { in: itemIds }, actLine: { act: { projectId, status: "SIGNED", id: { notIn: exclude }, currency: act.currency } } },
      include: { actLine: { include: { act: { select: { contractId: true } } } } },
    }),
    prisma.estimateVersion.findFirst({ where: { projectId, status: "ACTIVE" } }),
  ]);
  const lines = active ? await prisma.estimateLine.findMany({ where: { versionId: active.id, workItemId: { in: itemIds } } }) : [];
  const sumBy = (rows: { workItemId: string; v: Num }[]) => {
    const m = new Map<string, Num>();
    for (const r of rows) m.set(r.workItemId, (m.get(r.workItemId) ?? new Decimal(0))!.plus(r.v ?? 0));
    return m;
  };
  return checkActLimits({
    actTotal,
    hasContract: !!act.contractId,
    contractAmount: contractAmount.value,
    otherSignedForContract: sumKnown(otherSignedContract.map((l) => dec(l.amount))).sum,
    allocations,
    contractQtyByItem: new Map(contractAllocs.map((a) => [a.workItemId, dec(a.quantity)])),
    otherSignedQtyByItem: sumBy(otherAllocs.filter((a) => a.actLine.act.contractId === act.contractId).map((a) => ({ workItemId: a.workItemId, v: dec(a.quantity) }))),
    plannedCostByItem: new Map(lines.map((l) => [l.workItemId!, plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) }).value])),
    otherAcceptedByItem: sumBy(otherAllocs.map((a) => ({ workItemId: a.workItemId, v: dec(a.amount) }))),
    unallocatedLines: act.lines.filter((l) => l.allocations.length === 0).length,
  });
}

export interface DuplicateCandidate {
  actId: string;
  number: string;
  date: string;
  status: string;
  total: string | null;
  contractor: string | null;
  reasons: string[];
  strength: "exact" | "strong" | "weak";
}

/** Поиск вероятных дубликатов акта: номер, дата, подрядчик, договор, сумма, объект, контрольная сумма файла. */
export async function findDuplicateActs(
  projectId: string,
  q: { number: string | null; date: string | null; contractorId: string | null; contractId: string | null; total: string | null; objectText?: string | null; sha256s?: string[]; excludeActId?: string | null },
): Promise<DuplicateCandidate[]> {
  const acts = await prisma.act.findMany({
    where: { projectId, ...(q.excludeActId ? { NOT: { id: q.excludeActId } } : {}) },
    include: {
      lines: { select: { amount: true } },
      contractor: { select: { name: true } },
      document: { select: { sha256: true } },
      recognition: { include: { pages: { include: { document: { select: { sha256: true } } } } } },
    },
  });
  const key = looseDocKey(q.number);
  const total = dec(q.total);
  const out: DuplicateCandidate[] = [];
  for (const a of acts) {
    const reasons: string[] = [];
    let strength: DuplicateCandidate["strength"] | null = null;
    const shas = [a.document?.sha256, ...(a.recognition?.pages.map((p) => p.document.sha256) ?? [])].filter(Boolean) as string[];
    if (q.sha256s?.some((s) => shas.includes(s))) {
      reasons.push("тот же файл / фотография");
      strength = "exact";
    }
    const aTotal = sumKnown(a.lines.map((l) => dec(l.amount))).sum;
    const sameNumber = key && looseDocKey(a.number) === key;
    const sameContractor = q.contractorId && a.contractorId === q.contractorId;
    const sameContract = q.contractId && a.contractId === q.contractId;
    const sameDate = q.date && a.date.toISOString().slice(0, 10) === q.date;
    const sameTotal = total && aTotal && total.minus(aTotal).abs().lte(1);
    if (sameNumber) reasons.push("совпадает номер");
    if (sameDate) reasons.push("совпадает дата");
    if (sameContractor) reasons.push("тот же подрядчик");
    if (sameContract) reasons.push("тот же договор");
    if (sameTotal) reasons.push("совпадает сумма");
    if (q.objectText && a.objectText && q.objectText.trim().toLowerCase() === a.objectText.trim().toLowerCase()) reasons.push("тот же объект");
    if (!strength) {
      if (sameNumber && (sameContractor || sameContract || (!q.contractorId && !q.contractId))) strength = "strong";
      else if (sameTotal && sameDate && (sameContractor || sameContract)) strength = "strong";
      else if (sameNumber || (sameTotal && (sameContractor || sameContract))) strength = "weak";
    }
    if (strength) {
      out.push({
        actId: a.id,
        number: a.number,
        date: a.date.toISOString().slice(0, 10),
        status: a.status,
        total: aTotal?.toFixed(2) ?? null,
        contractor: a.contractor?.name ?? a.contractorName,
        reasons,
        strength,
      });
    }
  }
  const order = { exact: 0, strong: 1, weak: 2 };
  return out.sort((a, b) => order[a.strength] - order[b.strength]);
}

// ───────────── Статусы ─────────────

/**
 * Смена юридического статуса акта. «Подписан» устанавливается только пользователем с правом act.sign
 * и с указанием даты подписания; при нарушении лимитов — только с оформленным исключением.
 * Подписание корректировочного акта переводит исходный в «скорректирован» (исключается из расчёта).
 */
export async function changeActStatus(
  userId: string,
  projectId: string,
  actId: string,
  to: ActStatus,
  opts: { comment: string | null; signedAt?: string | null; override?: boolean; canOverride: boolean },
) {
  const act = await prisma.act.findFirst({ where: { id: actId, projectId } });
  if (!act) throw new UserError("Акт не найден");
  const allowed: Record<ActStatus, ActStatus[]> = {
    DRAFT: ["ON_APPROVAL", "SIGNED", "ANNULLED"],
    ON_APPROVAL: ["SIGNED", "REJECTED", "DRAFT", "ANNULLED"],
    REJECTED: ["DRAFT", "ANNULLED"],
    SIGNED: ["ANNULLED"],
    CORRECTED: [],
    ANNULLED: [],
  };
  if (!allowed[act.status].includes(to)) throw new UserError(`Переход «${act.status} → ${to}» недопустим`);
  if ((to === "REJECTED" || to === "ANNULLED") && !opts.comment?.trim()) throw new UserError("Укажите причину");
  let violations: LimitViolation[] = [];
  let signedAt: Date | null = null;
  if (to === "SIGNED") {
    if (!opts.signedAt) throw new UserError("Укажите дату подписания акта сторонами");
    signedAt = new Date(opts.signedAt + "T12:00:00Z");
    if (isNaN(signedAt.getTime()) || signedAt.getTime() > Date.now() + 86400000) throw new UserError("Некорректная дата подписания");
    const dups = await findDuplicateActs(projectId, { number: act.number, date: act.date.toISOString().slice(0, 10), contractorId: act.contractorId, contractId: act.contractId, total: null, excludeActId: act.id });
    if (dups.some((d) => d.strength !== "weak" && d.status === "SIGNED" && d.actId !== act.correctsActId) && !act.duplicateDecision)
      throw new UserError("Найден подписанный акт с тем же номером и подрядчиком. Подтвердите, что это другой документ (в карточке акта), или аннулируйте дубликат.");
    violations = await actLimitViolations(projectId, actId);
    // Нераспределённые строки и отсутствие суммы договора — предупреждения, остальное требует исключения
    const blocking = violations.filter((v) => v.code !== "NO_CONTRACT_AMOUNT" && v.code !== "UNALLOCATED_LINES");
    if (blocking.length) {
      if (!opts.override) throw new UserError(`Нарушены лимиты: ${blocking.map((v) => v.text).join("; ")}. Подписание возможно только с оформленным исключением.`);
      if (!opts.canOverride) throw new UserError("Нет права подтверждать исключения по лимитам");
      if (!opts.comment?.trim()) throw new UserError("Для исключения укажите обоснование");
    }
  }
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.act.update({
      where: { id: actId },
      data: {
        status: to,
        statusChangedAt: now,
        ...(to === "SIGNED" ? { signedAt, signedById: userId, ...(opts.override ? { limitOverride: true, limitOverrideComment: opts.comment, limitOverrideById: userId } : {}) } : {}),
        ...(to === "ANNULLED" ? { annulledAt: now } : {}),
      },
    });
    if (to === "SIGNED" && act.correctsActId) {
      await tx.act.update({ where: { id: act.correctsActId }, data: { status: "CORRECTED", correctedAt: now, statusChangedAt: now } });
      await logAudit({ userId, projectId, action: "act.corrected", entityType: "Act", entityId: act.correctsActId, after: { replacedBy: actId } }, tx);
    }
    await logAudit(
      { userId, projectId, action: "act.status", entityType: "Act", entityId: actId, before: { status: act.status }, after: { status: to, signedAt, override: !!opts.override, violations: violations.map((v) => v.code) }, comment: opts.comment },
      tx,
    );
  });
}

/** Корректировочный акт: копия строк исходного подписанного акта, редактируется и подписывается отдельно. */
export async function createCorrection(userId: string, projectId: string, actId: string): Promise<string> {
  const act = await prisma.act.findFirst({ where: { id: actId, projectId }, include: { lines: { include: { allocations: true }, orderBy: { sortOrder: "asc" } }, corrections: true } });
  if (!act) throw new UserError("Акт не найден");
  if (act.status !== "SIGNED") throw new UserError("Корректировать можно только подписанный акт");
  if (act.corrections.some((c) => !["ANNULLED", "REJECTED"].includes(c.status))) throw new UserError("У акта уже есть действующий корректировочный акт");
  return createAct(
    userId,
    projectId,
    {
      number: `${act.number}-корр`,
      date: new Date().toISOString().slice(0, 10),
      periodFrom: act.periodFrom?.toISOString().slice(0, 10),
      periodTo: act.periodTo?.toISOString().slice(0, 10),
      contractId: act.contractId,
      contractorId: act.contractorId,
      currency: act.currency,
      objectText: act.objectText,
      comment: `Корректировка акта № ${act.number}`,
    },
    act.lines.map((l) => ({
      lineNo: l.lineNo,
      code: l.code,
      description: l.description ?? "",
      unit: l.unit,
      quantity: l.quantity?.toString() ?? null,
      unitPrice: l.unitPrice?.toString() ?? null,
      amount: l.amount.toString(),
      note: l.note,
      allocations: l.allocations.map((a) => ({ workItemId: a.workItemId, quantity: a.quantity?.toString() ?? null, amount: a.amount.toString() })),
    })),
    { correctsActId: act.id },
  );
}

export async function setDuplicateDecision(userId: string, projectId: string, actId: string, comment: string | null) {
  if (!comment?.trim()) throw new UserError("Укажите, чем документ отличается от найденного");
  const act = await prisma.act.findFirst({ where: { id: actId, projectId } });
  if (!act) throw new UserError("Акт не найден");
  await prisma.act.update({ where: { id: actId }, data: { duplicateDecision: comment } });
  await logAudit({ userId, projectId, action: "act.duplicateDecision", entityType: "Act", entityId: actId, comment });
}
