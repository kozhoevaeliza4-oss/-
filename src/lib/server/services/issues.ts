import "server-only";
import { IssueSeverity, IssueStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";
import { loadRegistry } from "../registry";
import { loadContracts } from "../contracts";
import { dec, sumKnown } from "@/lib/calc/decimal";

/**
 * Контроль отклонений: проверки находят условия и создают карточки проблем.
 * Карточка закрывается только если условие больше не обнаруживается (устранено данными)
 * или ответственный закрывает её с обоснованным исключением. Скрыть предупреждение нельзя.
 */
export interface DetectedIssue {
  key: string;
  type: string;
  title: string;
  severity: IssueSeverity;
  source: string;
  details?: string;
  amount?: string | null;
  workItemId?: string | null;
  contractId?: string | null;
  actId?: string | null;
  transactionId?: string | null;
}

export const ISSUE_TYPES: Record<string, string> = {
  WORK_WITHOUT_CONTRACT: "Работы выполняются без договора",
  NO_CONTRACT: "Статья без договора",
  VOLUME_OVERRUN: "Превышение объёма",
  COST_OVERRUN: "Затраты выше плана выполненного",
  ACTS_RECONCILIATION: "Расхождение физической готовности и АВР",
  OVERDUE: "Просроченные работы",
  STALE_PROGRESS: "Нет обновлений выполнения",
  CONTRACT_OVER_PLAN: "Договор выше плановой стоимости",
  CONTRACT_NO_ITEMS: "Договор без сопоставленных статей",
  CONTRACT_OVER_ALLOCATED: "Распределено больше суммы договора",
  CONTRACT_EXPIRED: "Истёк срок договора",
  ACTS_OVER_CONTRACT: "АВР превышают сумму договора",
  CONTRACT_PENDING_REVIEW: "Договор ожидает проверки",
  ACT_WITHOUT_CONTRACT: "АВР без договора",
  ACT_UNMATCHED_LINES: "Строки АВР без статьи сметы",
  UNCLASSIFIED_TRANSACTIONS: "Операции 1С без классификации",
  POSSIBLE_DUPLICATE_TRANSACTION: "Возможный дубль операции 1С",
  REMOVED_ITEM_WITH_DOCUMENTS: "Статья исключена из сметы, но есть договоры/акты",
  ESTIMATE_DRAFT_PENDING: "Черновик сметы ожидает утверждения",
};

const STALE_DAYS = 30;

export async function detectIssues(projectId: string, today = new Date()): Promise<DetectedIssue[]> {
  const [reg, contracts, acts, unclassified, dupTx, drafts] = await Promise.all([
    loadRegistry(projectId, { today }),
    loadContracts(projectId, today),
    prisma.act.findMany({ where: { projectId, status: { in: ["DRAFT", "ON_APPROVAL", "SIGNED"] } }, include: { lines: { include: { allocations: { select: { id: true } } } } } }),
    prisma.accountingTransaction.aggregate({ where: { projectId, classification: "UNCLASSIFIED" }, _count: true, _sum: { amount: true } }),
    prisma.accountingTransaction.findMany({ where: { projectId, possibleDuplicateOfId: { not: null }, classification: { not: "EXCLUDED" } }, select: { id: true, documentNumber: true, amount: true } }),
    prisma.estimateVersion.findMany({ where: { projectId, status: "DRAFT" } }),
  ]);
  const out: DetectedIssue[] = [];
  const label = (r: { code: string | null; name: string }) => `${r.code ? r.code + " " : ""}${r.name}`;
  const allocatedItems = new Set((await prisma.contractWorkAllocation.findMany({ where: { contract: { projectId }, status: { not: "REJECTED" } }, select: { workItemId: true } })).map((a) => a.workItemId));
  const actItems = new Set((await prisma.actLineAllocation.findMany({ where: { actLine: { act: { projectId } } }, select: { workItemId: true } })).map((a) => a.workItemId));

  for (const r of reg.rows) {
    const has = (c: string) => r.flags.some((f) => f.code === c);
    if (has("WORK_WITHOUT_CONTRACT")) out.push({ key: `WORK_WITHOUT_CONTRACT:${r.id}`, type: "WORK_WITHOUT_CONTRACT", title: label(r), severity: "HIGH", source: "Реестр: выполнение без подтверждённого договора", amount: r.earnedValue ?? r.plannedCost, workItemId: r.id });
    else if (r.active && !r.covered && r.coverageStatus === "NONE") out.push({ key: `NO_CONTRACT:${r.id}`, type: "NO_CONTRACT", title: label(r), severity: "MEDIUM", source: "Договорное покрытие", amount: r.plannedCost, workItemId: r.id });
    if (r.overrunQuantity !== null && !r.overrunConfirmed)
      out.push({ key: `VOLUME_OVERRUN:${r.id}`, type: "VOLUME_OVERRUN", title: label(r), severity: "HIGH", source: "Физическое выполнение", details: `Превышение ${r.overrunQuantity} ${r.unit ?? ""}, не подтверждено`, amount: r.unconfirmedOverrunValue, workItemId: r.id });
    if (has("COST_OVERRUN") || has("COST_OVERRUN_PRELIMINARY"))
      out.push({ key: `COST_OVERRUN:${r.id}`, type: "COST_OVERRUN", title: label(r), severity: has("COST_OVERRUN") ? "HIGH" : "MEDIUM", source: has("COST_OVERRUN") ? "Затраты 1С" : "Затраты 1С (методика не подтверждена)", amount: r.variance, workItemId: r.id });
    if (has("RECONCILE_ACTS")) out.push({ key: `ACTS_RECONCILIATION:${r.id}`, type: "ACTS_RECONCILIATION", title: label(r), severity: "MEDIUM", source: "Сверка выполнения и АВР", amount: r.earnedVsActs, workItemId: r.id, details: r.flags.find((f) => f.code === "RECONCILE_ACTS")?.text });
    if (r.overdue) out.push({ key: `OVERDUE:${r.id}`, type: "OVERDUE", title: label(r), severity: "MEDIUM", source: "Сроки", details: `Плановое завершение ${r.plannedEndDate}`, workItemId: r.id });
    const started = r.percentRaw !== null && Number(r.percentRaw) > 0 && Number(r.percentRaw) < 100;
    if (started && r.progressAsOf && (today.getTime() - new Date(r.progressAsOf).getTime()) / 86400000 > STALE_DAYS)
      out.push({ key: `STALE_PROGRESS:${r.id}`, type: "STALE_PROGRESS", title: label(r), severity: "LOW", source: "Физическое выполнение", details: `Последнее обновление ${r.progressAsOf}`, workItemId: r.id });
    if (!r.active && (allocatedItems.has(r.id) || actItems.has(r.id)))
      out.push({ key: `REMOVED_ITEM_WITH_DOCUMENTS:${r.id}`, type: "REMOVED_ITEM_WITH_DOCUMENTS", title: label(r), severity: "MEDIUM", source: "Версии сметы", workItemId: r.id });
  }
  for (const c of contracts) {
    const t = `Договор № ${c.number ?? "—"}${c.contractor ? ` (${c.contractor})` : ""}`;
    if (c.flags.includes("NO_ITEMS")) out.push({ key: `CONTRACT_NO_ITEMS:${c.id}`, type: "CONTRACT_NO_ITEMS", title: t, severity: "HIGH", source: "Договоры", amount: c.currentAmount, contractId: c.id });
    if (c.flags.includes("OVER_ALLOCATED")) out.push({ key: `CONTRACT_OVER_ALLOCATED:${c.id}`, type: "CONTRACT_OVER_ALLOCATED", title: t, severity: "HIGH", source: "Договоры", amount: c.unallocated ? String(-Number(c.unallocated)) : null, contractId: c.id });
    if (c.flags.includes("OVER_PLAN")) out.push({ key: `CONTRACT_OVER_PLAN:${c.id}`, type: "CONTRACT_OVER_PLAN", title: t, severity: "MEDIUM", source: "Договоры", amount: c.allocatedConfirmed && c.plannedCostOfItems ? (Number(c.allocatedConfirmed) - Number(c.plannedCostOfItems)).toFixed(2) : null, contractId: c.id });
    if (c.flags.includes("EXPIRED")) out.push({ key: `CONTRACT_EXPIRED:${c.id}`, type: "CONTRACT_EXPIRED", title: t, severity: "MEDIUM", source: "Договоры", details: `Срок окончания ${c.endDate}`, contractId: c.id });
    if (c.flags.includes("ACTS_OVER_CONTRACT")) out.push({ key: `ACTS_OVER_CONTRACT:${c.id}`, type: "ACTS_OVER_CONTRACT", title: t, severity: "CRITICAL", source: "АВР", amount: c.actsAccepted && c.currentAmount ? (Number(c.actsAccepted) - Number(c.currentAmount)).toFixed(2) : null, contractId: c.id });
    if (c.flags.includes("PENDING_REVIEW")) out.push({ key: `CONTRACT_PENDING_REVIEW:${c.id}`, type: "CONTRACT_PENDING_REVIEW", title: t, severity: "LOW", source: "Договоры", contractId: c.id });
  }
  for (const a of acts) {
    const t = `АВР № ${a.number}`;
    const total = sumKnown(a.lines.map((l) => dec(l.amount))).sum?.toFixed(2) ?? null;
    if (!a.contractId) out.push({ key: `ACT_WITHOUT_CONTRACT:${a.id}`, type: "ACT_WITHOUT_CONTRACT", title: t, severity: a.status === "SIGNED" ? "HIGH" : "MEDIUM", source: "АВР", amount: total, actId: a.id });
    const un = a.lines.filter((l) => l.allocations.length === 0);
    if (un.length)
      out.push({ key: `ACT_UNMATCHED_LINES:${a.id}`, type: "ACT_UNMATCHED_LINES", title: t, severity: a.status === "SIGNED" ? "HIGH" : "MEDIUM", source: "АВР", details: `Строк без статьи: ${un.length}`, amount: sumKnown(un.map((l) => dec(l.amount))).sum?.toFixed(2) ?? null, actId: a.id });
  }
  if (unclassified._count > 0)
    out.push({ key: "UNCLASSIFIED_TRANSACTIONS", type: "UNCLASSIFIED_TRANSACTIONS", title: `Операций без классификации: ${unclassified._count}`, severity: "MEDIUM", source: "Импорт 1С", amount: unclassified._sum.amount?.toString() ?? null });
  for (const t of dupTx) out.push({ key: `POSSIBLE_DUPLICATE_TRANSACTION:${t.id}`, type: "POSSIBLE_DUPLICATE_TRANSACTION", title: `Операция ${t.documentNumber ?? ""}`.trim(), severity: "HIGH", source: "Импорт 1С", amount: t.amount?.toString() ?? null, transactionId: t.id });
  for (const v of drafts) out.push({ key: `ESTIMATE_DRAFT_PENDING:${v.id}`, type: "ESTIMATE_DRAFT_PENDING", title: `Смета v${v.versionNumber} «${v.name}»`, severity: "LOW", source: "Сметы" });
  return out;
}

/** Синхронизация карточек проблем с текущими данными. */
export async function syncIssues(projectId: string, userId: string | null = null, today = new Date()) {
  const detected = await detectIssues(projectId, today);
  const existing = await prisma.issue.findMany({ where: { projectId } });
  const byKey = new Map(existing.map((i) => [i.key, i]));
  const seen = new Set<string>();
  let created = 0;
  let resolved = 0;
  let reopened = 0;
  for (const d of detected) {
    seen.add(d.key);
    const e = byKey.get(d.key);
    const data = {
      type: d.type,
      title: d.title,
      severity: d.severity,
      source: d.source,
      details: d.details ?? null,
      amount: d.amount ?? null,
      workItemId: d.workItemId ?? null,
      contractId: d.contractId ?? null,
      actId: d.actId ?? null,
      transactionId: d.transactionId ?? null,
      isActive: true,
      lastSeenAt: today,
    };
    if (!e) {
      await prisma.issue.create({ data: { ...data, projectId, key: d.key, detectedAt: today, events: { create: { action: "detected", toStatus: "NEW", comment: "Обнаружено проверкой" } } } });
      created++;
    } else if (e.status === "RESOLVED") {
      await prisma.issue.update({ where: { id: e.id }, data: { ...data, status: "NEW", resolvedAt: null, events: { create: { action: "reopened", fromStatus: "RESOLVED", toStatus: "NEW", comment: "Условие обнаружено снова" } } } });
      reopened++;
    } else {
      await prisma.issue.update({ where: { id: e.id }, data });
    }
  }
  for (const e of existing) {
    if (seen.has(e.key) || !e.isActive) continue;
    if (e.status === "CLOSED_EXCEPTION") {
      await prisma.issue.update({ where: { id: e.id }, data: { isActive: false } });
      continue;
    }
    await prisma.issue.update({
      where: { id: e.id },
      data: { isActive: false, status: "RESOLVED", resolvedAt: today, events: { create: { action: "resolved", fromStatus: e.status, toStatus: "RESOLVED", comment: "Условие больше не выполняется — устранено по данным" } } },
    });
    resolved++;
  }
  if (userId) await logAudit({ userId, projectId, action: "issues.sync", entityType: "Project", entityId: projectId, after: { detected: detected.length, created, resolved, reopened } });
  return { detected: detected.length, created, resolved, reopened };
}

/** Синхронизация, если последняя проверка старше указанного интервала. */
export async function syncIssuesIfStale(projectId: string, maxAgeMs = 10 * 60 * 1000) {
  const last = await prisma.issue.aggregate({ where: { projectId }, _max: { lastSeenAt: true } });
  const ts = last._max.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - ts > maxAgeMs) await syncIssues(projectId);
}

const MANUAL: IssueStatus[] = ["ASSIGNED", "IN_REVIEW", "NEEDS_DECISION", "CLOSED_EXCEPTION", "NEW"];

export async function updateIssue(
  userId: string,
  projectId: string,
  issueId: string,
  input: { status?: IssueStatus | null; assigneeId?: string | null; comment?: string | null },
) {
  const issue = await prisma.issue.findFirst({ where: { id: issueId, projectId } });
  if (!issue) throw new UserError("Проблема не найдена");
  const comment = input.comment?.trim() || null;
  const data: Prisma.IssueUpdateInput = {};
  const events: Prisma.IssueEventCreateWithoutIssueInput[] = [];
  if (input.assigneeId !== undefined && input.assigneeId !== issue.assigneeId) {
    if (input.assigneeId) {
      const member = await prisma.user.findFirst({ where: { id: input.assigneeId, OR: [{ isAdmin: true }, { memberships: { some: { projectId } } }] } });
      if (!member) throw new UserError("Ответственный должен быть участником проекта");
    }
    data.assignee = input.assigneeId ? { connect: { id: input.assigneeId } } : { disconnect: true };
    events.push({ action: "assigned", comment: input.assigneeId ? "Назначен ответственный" : "Ответственный снят", user: { connect: { id: userId } } });
    if (issue.status === "NEW" && input.assigneeId && !input.status) {
      data.status = "ASSIGNED";
      events[events.length - 1].fromStatus = "NEW";
      events[events.length - 1].toStatus = "ASSIGNED";
    }
  }
  if (input.status && input.status !== issue.status) {
    if (input.status === "RESOLVED") throw new UserError("Статус «Устранена» устанавливается автоматически, когда проверка больше не находит условие. Исправьте данные или закройте с обоснованным исключением.");
    if (!MANUAL.includes(input.status)) throw new UserError("Недопустимый статус");
    if (input.status === "CLOSED_EXCEPTION" && (!comment || comment.length < 10)) throw new UserError("Для закрытия с исключением укажите обоснование (не короче 10 символов)");
    if (issue.status === "RESOLVED") throw new UserError("Проблема устранена по данным");
    data.status = input.status;
    if (input.status === "CLOSED_EXCEPTION") data.resolvedAt = new Date();
    events.push({ action: "status", fromStatus: issue.status, toStatus: input.status, comment, user: { connect: { id: userId } } });
  } else if (comment) {
    events.push({ action: "comment", comment, user: { connect: { id: userId } } });
  }
  if (comment) data.comment = comment;
  if (!events.length) throw new UserError("Нет изменений");
  data.events = { create: events };
  await prisma.issue.update({ where: { id: issueId }, data });
  await logAudit({ userId, projectId, action: "issue.update", entityType: "Issue", entityId: issueId, before: { status: issue.status, assigneeId: issue.assigneeId }, after: input, comment });
}
