import "server-only";
import { createHash } from "node:crypto";
import { Prisma, TransactionCategory } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";
import { readDocument, saveUpload } from "../storage";
import { parse } from "./project";
import { ParseError, parseTabular, Sheet } from "@/lib/import/tabular";
import { ACC_FIELDS, AccField, AccountingMapping, AccPreview, buildAccountingPreview, guessAccountingMapping, matchRule, RuleInput } from "@/lib/import/accounting";
import { dec, Decimal, sumKnown } from "@/lib/calc/decimal";
import { TRANSACTION_CATEGORY } from "@/lib/labels";

export const ACCOUNTING_EXTENSIONS = ["xlsx", "xlsm", "csv", "txt"];

// ───────────── Загрузка и предпросмотр ─────────────

export async function startAccountingImport(userId: string, projectId: string, file: File | null): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const doc = await saveUpload({ file, projectId, kind: "ACCOUNTING", userId, allowed: ACCOUNTING_EXTENSIONS });
  let sheets: Sheet[];
  try {
    sheets = await parseTabular(doc.buffer, doc.originalName);
  } catch (e) {
    const message = e instanceof ParseError ? e.message : "Не удалось разобрать файл";
    await prisma.importJob.create({ data: { projectId, kind: "ACCOUNTING", status: "FAILED", documentId: doc.id, error: message, createdById: userId, finishedAt: new Date() } });
    throw new UserError(message);
  }
  const mapping = guessAccountingMapping(sheets, project.currency);
  const job = await prisma.importJob.create({
    data: { projectId, kind: "ACCOUNTING", status: "PARSED", documentId: doc.id, mapping: mapping as unknown as Prisma.InputJsonValue, createdById: userId },
  });
  await logAudit({ userId, projectId, action: "accounting.upload", entityType: "ImportJob", entityId: job.id, after: { file: doc.originalName, sha256: doc.sha256 } });
  return job.id;
}

export interface AccountingPreviewResult {
  preview: AccPreview;
  /** Отпечатки, уже имеющиеся в БД (повторно не учитываются) */
  existing: Set<string>;
  /** Возможные дубли: та же дата, документ и сумма, но другая аналитика */
  nearDuplicates: Map<number, string>;
  newRows: number;
  newTotal: string;
  categories: { category: string; label: string; count: number; total: string }[];
  rulesApplied: Map<number, RuleInput>;
  sameFileImports: { id: string; createdAt: Date }[];
}

export async function loadAccountingJob(projectId: string, jobId: string) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, projectId, kind: "ACCOUNTING" }, include: { document: true, createdBy: { select: { name: true } }, accountingImport: true } });
  if (!job) return null;
  const mapping = job.mapping as unknown as AccountingMapping | null;
  if (job.status !== "PARSED" || !job.document || !mapping) return { job, mapping, sheets: [] as Sheet[], result: null };
  const sheets = await parseTabular(await readDocument(job.document.storagePath), job.document.originalName);
  const preview = buildAccountingPreview(sheets, mapping);
  return { job, mapping, sheets, result: await analyze(projectId, preview, job.document.sha256, job.id) };
}

async function analyze(projectId: string, preview: AccPreview, sha: string, jobId: string): Promise<AccountingPreviewResult> {
  const fps = preview.rows.map((r) => r.fingerprint);
  const existing = new Set<string>();
  for (let i = 0; i < fps.length; i += 1000) {
    const found = await prisma.accountingTransaction.findMany({ where: { projectId, fingerprint: { in: fps.slice(i, i + 1000) } }, select: { fingerprint: true } });
    found.forEach((f) => existing.add(f.fingerprint));
  }
  const rules = await prisma.classificationRule.findMany({ where: { projectId } });
  const nearDuplicates = new Map<number, string>();
  const valid = preview.rows.filter((r) => !r.errors.length);
  const fresh = valid.filter((r) => !existing.has(r.fingerprint));
  // Возможные дубли среди новых строк: совпадают дата, документ и сумма с уже загруженной операцией
  for (const r of fresh) {
    if (!r.date || !r.documentNumber || !r.amount) continue;
    const t = await prisma.accountingTransaction.findFirst({
      where: { projectId, date: new Date(r.date + "T00:00:00Z"), documentNumber: r.documentNumber, amount: r.amount },
      select: { id: true },
    });
    if (t) nearDuplicates.set(r.rowNumber, t.id);
  }
  const rulesApplied = new Map<number, RuleInput>();
  const byCat = new Map<string, { count: number; total: Decimal }>();
  for (const r of fresh) {
    const rule = matchRule(r, rules);
    if (rule) rulesApplied.set(r.rowNumber, rule);
    const cat = rule?.category ?? "UNCLASSIFIED";
    const e = byCat.get(cat) ?? { count: 0, total: new Decimal(0) };
    e.count++;
    e.total = e.total.plus(dec(r.amount) ?? 0);
    byCat.set(cat, e);
  }
  const sameFile = await prisma.importJob.findMany({ where: { projectId, kind: "ACCOUNTING", status: "CONFIRMED", document: { sha256: sha }, NOT: { id: jobId } }, select: { id: true, createdAt: true } });
  return {
    preview,
    existing,
    nearDuplicates,
    newRows: fresh.length,
    newTotal: (sumKnown(fresh.map((r) => dec(r.amount))).sum ?? new Decimal(0)).toFixed(2),
    categories: [...byCat].map(([category, v]) => ({ category, label: TRANSACTION_CATEGORY[category] ?? category, count: v.count, total: v.total.toFixed(2) })),
    rulesApplied,
    sameFileImports: sameFile,
  };
}

const mappingSchema = z.object({
  sheetIndex: z.coerce.number().int().min(0),
  headerRow: z.coerce.number().int().min(1),
  amountMode: z.enum(["amount", "debit_minus_credit", "debit", "credit"]),
  defaultAccount: z.string().trim().max(20).optional().transform((v) => v || null),
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
});

export async function updateAccountingMapping(userId: string, projectId: string, jobId: string, form: Record<string, string | undefined>) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, projectId, kind: "ACCOUNTING" } });
  if (!job || job.status !== "PARSED") throw new UserError("Импорт недоступен для изменения");
  const r = mappingSchema.safeParse(form);
  if (!r.success) throw new UserError("Некорректные параметры сопоставления");
  const columns: AccountingMapping["columns"] = {};
  for (const f of Object.keys(ACC_FIELDS) as AccField[]) {
    const v = form[`col_${f}`];
    if (v !== undefined && v !== "" && Number.isInteger(Number(v))) columns[f] = Number(v);
  }
  await prisma.importJob.update({ where: { id: jobId }, data: { mapping: { ...r.data, columns } as unknown as Prisma.InputJsonValue } });
  void userId;
}

/**
 * Подтверждение импорта. Все строки записываются одной транзакцией: при ошибке ничего не меняется,
 * ранее подтверждённые данные не затрагиваются. Уже загруженные операции (по отпечатку) пропускаются.
 * Строки с ошибками не импортируются и перечисляются в журнале.
 */
export async function confirmAccountingImport(userId: string, projectId: string, jobId: string) {
  const loaded = await loadAccountingJob(projectId, jobId);
  if (!loaded || !loaded.result) throw new UserError(loaded?.job.status === "CONFIRMED" ? "Импорт уже подтверждён" : "Импорт недоступен");
  const { job, result, mapping } = loaded;
  const { preview } = result;
  if (preview.mappingErrors.length) throw new UserError(preview.mappingErrors[0]);
  const valid = preview.rows.filter((r) => !r.errors.length);
  const fresh = valid.filter((r) => !result.existing.has(r.fingerprint));
  const errorRows = preview.rows.filter((r) => r.errors.length);

  const summary = await prisma.$transaction(
    async (tx) => {
      const locked = await tx.importJob.updateMany({ where: { id: jobId, status: "PARSED" }, data: { status: "CONFIRMED", finishedAt: new Date() } });
      if (locked.count === 0) throw new UserError("Импорт уже подтверждён");
      const imp = await tx.accountingImport.create({
        data: {
          projectId,
          documentId: job.documentId,
          importJobId: job.id,
          account: mapping?.defaultAccount ?? (([...new Set(valid.map((r) => r.account).filter(Boolean))] as string[]).join(", ").slice(0, 100) || null),
          periodFrom: minDate(valid.map((r) => r.date)),
          periodTo: maxDate(valid.map((r) => r.date)),
          rowCount: preview.rows.length,
          newRows: 0,
          duplicateRows: valid.length - fresh.length,
          sourceTotal: preview.sourceTotal,
          fileSha256: job.document?.sha256 ?? null,
          status: "CONFIRMED",
        },
      });
      let inserted = 0;
      let acceptedTotal = new Decimal(0);
      for (let i = 0; i < fresh.length; i += 500) {
        const chunk = fresh.slice(i, i + 500);
        const res = await tx.accountingTransaction.createMany({
          skipDuplicates: true,
          data: chunk.map((r) => {
            const rule = result.rulesApplied.get(r.rowNumber);
            return {
              projectId,
              importId: imp.id,
              rowNumber: r.rowNumber,
              fingerprint: r.fingerprint,
              date: r.date ? new Date(r.date + "T00:00:00Z") : null,
              documentNumber: r.documentNumber,
              account: r.account,
              corrAccount: r.corrAccount,
              debit: r.debit,
              credit: r.credit,
              amount: r.amount,
              currency: r.currency,
              counterparty: r.counterparty,
              objectText: r.objectText,
              costItemText: r.costItemText,
              contractText: r.contractText,
              nomenclature: r.nomenclature,
              quantity: r.quantity,
              comment: r.comment,
              raw: r.raw as Prisma.InputJsonValue,
              category: (rule?.category as TransactionCategory) ?? "UNCLASSIFIED",
              classification: rule ? "PROPOSED" : "UNCLASSIFIED",
              ruleId: rule?.id ?? null,
              possibleDuplicateOfId: result.nearDuplicates.get(r.rowNumber) ?? null,
            };
          }),
        });
        inserted += res.count;
      }
      // Предложенные правилом распределения (статья/договор) — не учитываются до подтверждения классификации
      const withRuleTargets = await tx.accountingTransaction.findMany({ where: { importId: imp.id, rule: { OR: [{ workItemId: { not: null } }, { contractId: { not: null } }] } }, include: { rule: true } });
      for (const t of withRuleTargets) {
        if (t.amount === null) continue;
        await tx.transactionAllocation.create({ data: { transactionId: t.id, workItemId: t.rule!.workItemId, contractId: t.rule!.contractId, amount: t.amount } });
      }
      const ins = await tx.accountingTransaction.findMany({ where: { importId: imp.id }, select: { amount: true } });
      acceptedTotal = sumKnown(ins.map((x) => dec(x.amount))).sum ?? new Decimal(0);
      await tx.accountingImport.update({ where: { id: imp.id }, data: { newRows: inserted, acceptedTotal } });
      const s = {
        rows: preview.rows.length,
        inserted,
        duplicates: valid.length - inserted,
        errorRows: errorRows.map((r) => ({ row: r.rowNumber, errors: r.errors })),
        sourceTotal: preview.sourceTotal,
        acceptedTotal: acceptedTotal.toFixed(2),
        proposedByRules: result.rulesApplied.size,
      };
      await tx.importJob.update({ where: { id: jobId }, data: { summary: s as unknown as Prisma.InputJsonValue } });
      await logAudit({ userId, projectId, action: "accounting.importConfirmed", entityType: "AccountingImport", entityId: imp.id, after: s }, tx);
      return s;
    },
    { timeout: 300_000 },
  );
  return summary;
}

function minDate(d: (string | null)[]) {
  const v = d.filter(Boolean).sort()[0];
  return v ? new Date(v + "T00:00:00Z") : null;
}
function maxDate(d: (string | null)[]) {
  const v = d.filter(Boolean).sort().pop();
  return v ? new Date(v + "T00:00:00Z") : null;
}

// ───────────── Классификация ─────────────

export const classifySchema = z.object({
  ids: z.array(z.string()).min(1, "Выберите операции"),
  category: z.nativeEnum(TransactionCategory),
  workItemId: z.string().nullish().transform((v) => v || null),
  contractId: z.string().nullish().transform((v) => v || null),
  exclude: z.boolean().default(false),
  reason: z.string().trim().max(1000).nullish().transform((v) => v || null),
});

/**
 * Подтверждение классификации выбранных операций (массово). Привязка к статье/договору заменяет прежнее распределение
 * (одна строка на всю сумму). Платёж с договором создаёт запись оплаты. Все изменения — в журнале.
 */
export async function classifyTransactions(userId: string, projectId: string, input: z.input<typeof classifySchema>) {
  const d = parse(classifySchema, input);
  if (d.exclude && !d.reason) throw new UserError("Укажите причину исключения");
  if (d.category === "UNCLASSIFIED" && !d.exclude) throw new UserError("Выберите категорию");
  if (d.workItemId && !(await prisma.workItem.findFirst({ where: { id: d.workItemId, projectId } }))) throw new UserError("Статья не найдена");
  const contract = d.contractId ? await prisma.contract.findFirst({ where: { id: d.contractId, projectId } }) : null;
  if (d.contractId && !contract) throw new UserError("Договор не найден");
  if (d.category === "PAYMENT" && !contract) throw new UserError("Для платежа укажите договор");
  const txs = await prisma.accountingTransaction.findMany({ where: { id: { in: d.ids }, projectId }, include: { allocations: true } });
  if (txs.length !== d.ids.length) throw new UserError("Часть операций не найдена");
  await prisma.$transaction(async (tx) => {
    for (const t of txs) {
      await tx.accountingTransaction.update({
        where: { id: t.id },
        data: { category: d.category, classification: d.exclude ? "EXCLUDED" : "CONFIRMED", exclusionReason: d.exclude ? d.reason : null, classifiedById: userId, classifiedAt: new Date() },
      });
      if (d.workItemId || d.contractId || d.exclude) {
        await tx.transactionAllocation.deleteMany({ where: { transactionId: t.id } });
        if (!d.exclude && t.amount !== null)
          await tx.transactionAllocation.create({ data: { transactionId: t.id, workItemId: d.workItemId, contractId: d.contractId, contractorId: contract?.contractorId ?? null, amount: t.amount, confirmedById: userId, confirmedAt: new Date() } });
      } else {
        await tx.transactionAllocation.updateMany({ where: { transactionId: t.id }, data: { confirmedById: userId, confirmedAt: new Date() } });
      }
      // Оплата — только для категории «Платёж» с договором
      await tx.payment.deleteMany({ where: { transactionId: t.id } });
      if (!d.exclude && d.category === "PAYMENT" && contract && t.amount !== null && t.date) {
        await tx.payment.create({
          data: { projectId, contractId: contract.id, contractorId: contract.contractorId, date: t.date, amount: dec(t.amount)!.abs().toFixed(2), currency: t.currency ?? "KGS", documentNumber: t.documentNumber, source: "EXCEL_IMPORT", transactionId: t.id, comment: "Из выгрузки 1С" },
        });
      }
    }
    await logAudit(
      {
        userId,
        projectId,
        action: d.exclude ? "accounting.exclude" : "accounting.classify",
        entityType: "AccountingTransaction",
        entityId: d.ids.length === 1 ? d.ids[0] : null,
        before: txs.map((t) => ({ id: t.id, category: t.category, classification: t.classification })),
        after: { count: d.ids.length, category: d.category, workItemId: d.workItemId, contractId: d.contractId },
        comment: d.reason,
      },
      tx,
    );
  });
}

/** Подтверждение предложенной правилом классификации без изменений. */
export async function confirmProposed(userId: string, projectId: string, ids: string[]) {
  const txs = await prisma.accountingTransaction.findMany({ where: { id: { in: ids }, projectId, classification: "PROPOSED" } });
  if (!txs.length) throw new UserError("Нет операций с предложенной классификацией среди выбранных");
  for (const t of txs) {
    await classifyTransactions(userId, projectId, { ids: [t.id], category: t.category });
  }
  return txs.length;
}

/** Разделение суммы операции между несколькими статьями. Сумма частей должна равняться сумме операции. */
export async function splitTransaction(userId: string, projectId: string, txId: string, parts: { workItemId: string; amount: string }[]) {
  const t = await prisma.accountingTransaction.findFirst({ where: { id: txId, projectId } });
  if (!t || t.amount === null) throw new UserError("Операция не найдена");
  if (!parts.length) throw new UserError("Добавьте хотя бы одну часть");
  const total = sumKnown(parts.map((p) => dec(p.amount))).sum ?? new Decimal(0);
  if (total.minus(t.amount.toString()).abs().gt("0.01")) throw new UserError(`Сумма частей (${total.toFixed(2)}) не равна сумме операции (${t.amount.toFixed(2)})`);
  const n = await prisma.workItem.count({ where: { id: { in: parts.map((p) => p.workItemId) }, projectId } });
  if (n !== new Set(parts.map((p) => p.workItemId)).size) throw new UserError("Часть статей не найдена");
  await prisma.$transaction(async (tx) => {
    await tx.transactionAllocation.deleteMany({ where: { transactionId: txId } });
    for (const p of parts) await tx.transactionAllocation.create({ data: { transactionId: txId, workItemId: p.workItemId, amount: p.amount, confirmedById: userId, confirmedAt: new Date() } });
    await tx.accountingTransaction.update({ where: { id: txId }, data: { category: t.category === "UNCLASSIFIED" ? "COST" : t.category, classification: "CONFIRMED", classifiedById: userId, classifiedAt: new Date() } });
    await logAudit({ userId, projectId, action: "accounting.split", entityType: "AccountingTransaction", entityId: txId, after: { parts } }, tx);
  });
}

/** Сброс классификации (возврат в «требует классификации»). */
export async function resetClassification(userId: string, projectId: string, ids: string[]) {
  await prisma.$transaction(async (tx) => {
    await tx.transactionAllocation.deleteMany({ where: { transaction: { id: { in: ids }, projectId } } });
    await tx.payment.deleteMany({ where: { transactionId: { in: ids }, projectId } });
    await tx.accountingTransaction.updateMany({ where: { id: { in: ids }, projectId }, data: { category: "UNCLASSIFIED", classification: "UNCLASSIFIED", ruleId: null, classifiedById: null, classifiedAt: null, exclusionReason: null } });
    await logAudit({ userId, projectId, action: "accounting.reset", entityType: "AccountingTransaction", after: { ids } }, tx);
  });
}

// ───────────── Правила ─────────────

export const ruleSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(200),
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  account: z.string().trim().max(20).optional().transform((v) => v || null),
  corrAccount: z.string().trim().max(20).optional().transform((v) => v || null),
  textContains: z.string().trim().max(200).optional().transform((v) => v || null),
  counterpartyContains: z.string().trim().max(200).optional().transform((v) => v || null),
  category: z.nativeEnum(TransactionCategory),
  workItemId: z.string().optional().transform((v) => v || null),
  contractId: z.string().optional().transform((v) => v || null),
});

export async function createRule(userId: string, projectId: string, input: Record<string, string | undefined>) {
  const d = parse(ruleSchema, input);
  if (!d.account && !d.corrAccount && !d.textContains && !d.counterpartyContains) throw new UserError("Задайте хотя бы одно условие правила");
  const r = await prisma.classificationRule.create({ data: { ...d, projectId } });
  await logAudit({ userId, projectId, action: "accounting.ruleCreate", entityType: "ClassificationRule", entityId: r.id, after: d });
}

export async function toggleRule(userId: string, projectId: string, ruleId: string, active: boolean | "delete") {
  const r = await prisma.classificationRule.findFirst({ where: { id: ruleId, projectId } });
  if (!r) throw new UserError("Правило не найдено");
  if (active === "delete") await prisma.classificationRule.delete({ where: { id: ruleId } });
  else await prisma.classificationRule.update({ where: { id: ruleId }, data: { isActive: active } });
  await logAudit({ userId, projectId, action: "accounting.rule", entityType: "ClassificationRule", entityId: ruleId, after: { active } });
}

/** Применить активные правила к операциям, ещё не классифицированным (результат — «предложено»). */
export async function applyRules(userId: string, projectId: string) {
  const rules = await prisma.classificationRule.findMany({ where: { projectId } });
  const txs = await prisma.accountingTransaction.findMany({ where: { projectId, classification: "UNCLASSIFIED" } });
  let n = 0;
  for (const t of txs) {
    const rule = matchRule(t, rules);
    if (!rule) continue;
    await prisma.accountingTransaction.update({ where: { id: t.id }, data: { category: rule.category as TransactionCategory, classification: "PROPOSED", ruleId: rule.id } });
    if ((rule.workItemId || rule.contractId) && t.amount !== null) {
      await prisma.transactionAllocation.deleteMany({ where: { transactionId: t.id } });
      await prisma.transactionAllocation.create({ data: { transactionId: t.id, workItemId: rule.workItemId, contractId: rule.contractId, amount: t.amount } });
    }
    n++;
  }
  await logAudit({ userId, projectId, action: "accounting.applyRules", entityType: "Project", entityId: projectId, after: { proposed: n } });
  return n;
}

export function fileSha(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}
