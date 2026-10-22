import "server-only";
import { prisma } from "./db";
import { loadRegistry, RegistryData, RegistryRowDTO } from "./registry";
import { loadContracts } from "./contracts";
import { dec, Decimal, Num, percentOf, sumKnown } from "@/lib/calc/decimal";
import { plannedCost } from "@/lib/calc/workItem";
import { effectiveActStatus, isCostTransaction } from "@/lib/calc/rules";

const s = (v: Num) => (v === null ? null : v.toString());
const sumRows = (rows: RegistryRowDTO[], pick: (r: RegistryRowDTO) => string | null) => {
  const r = sumKnown(rows.map((x) => dec(pick(x))));
  return { sum: s(r.sum), missing: r.missing };
};

export interface GroupSummary {
  id: string | null;
  name: string;
  items: number;
  plannedCost: string | null;
  earned: string | null;
  acts: string | null;
  cost: string | null;
  /** Готовность = Σ выполненного / Σ плана статей, по которым есть данные о выполнении */
  weightedPercent: string | null;
  /** Доля плановой стоимости, по которой есть данные о выполнении, % */
  dataCoverage: string | null;
  itemsWithoutPlan: number;
  itemsWithoutProgress: number;
}

function summarize(id: string | null, name: string, rows: RegistryRowDTO[]): GroupSummary {
  const withPlan = rows.filter((r) => r.plannedCost !== null);
  const withData = withPlan.filter((r) => r.earnedValue !== null);
  const planned = sumKnown(withPlan.map((r) => dec(r.plannedCost))).sum;
  const plannedWithData = sumKnown(withData.map((r) => dec(r.plannedCost))).sum;
  const earned = sumKnown(withData.map((r) => dec(r.earnedValue))).sum;
  return {
    id,
    name,
    items: rows.length,
    plannedCost: s(planned),
    earned: s(earned),
    acts: sumRows(rows, (r) => r.actsAccepted).sum,
    cost: sumRows(rows, (r) => r.accountingCost).sum,
    weightedPercent: s(percentOf(earned, plannedWithData)),
    dataCoverage: s(percentOf(plannedWithData, planned)),
    itemsWithoutPlan: rows.length - withPlan.length,
    itemsWithoutProgress: withPlan.length - withData.length,
  };
}

const month = (d: Date) => d.toISOString().slice(0, 7);

export async function loadDashboard(projectId: string) {
  const data: RegistryData = await loadRegistry(projectId);
  const cur = data.project.currency;
  const active = data.rows.filter((r) => r.active);

  const [baselineLines, contracts, acts, payments, txGroups, unallocatedCost, recs, pendingJobs, draftVersions, audit, stages, objects, sections, lastImport, issues, costTx] = await Promise.all([
    data.baselineVersion ? prisma.estimateLine.findMany({ where: { versionId: data.baselineVersion.id } }) : Promise.resolve([]),
    loadContracts(projectId),
    prisma.act.findMany({ where: { projectId, currency: cur }, include: { lines: { select: { amount: true } } } }),
    prisma.payment.findMany({ where: { projectId, currency: cur }, select: { amount: true } }),
    prisma.accountingTransaction.groupBy({ by: ["classification"], where: { projectId }, _count: true }),
    prisma.accountingTransaction.count({ where: { projectId, classification: "CONFIRMED", category: { in: ["COST", "ADJUSTMENT", "REVERSAL"] }, allocations: { none: { workItemId: { not: null } } } } }),
    prisma.actRecognition.count({ where: { projectId, status: { in: ["NEEDS_REVIEW", "REVIEWED", "FAILED"] } } }),
    prisma.importJob.count({ where: { projectId, status: "PARSED" } }),
    prisma.estimateVersion.count({ where: { projectId, status: "DRAFT" } }),
    prisma.auditLog.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 12, include: { user: { select: { name: true } } } }),
    prisma.constructionStage.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.constructionObject.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.estimateSection.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.accountingImport.findFirst({ where: { projectId, status: "CONFIRMED" }, orderBy: { createdAt: "desc" } }),
    prisma.issue.groupBy({ by: ["severity"], where: { projectId, status: { in: ["NEW", "ASSIGNED", "IN_REVIEW", "NEEDS_DECISION"] } }, _count: true }),
    prisma.accountingTransaction.findMany({ where: { projectId, classification: "CONFIRMED", currency: cur }, select: { date: true, amount: true, category: true, classification: true } }),
  ]);

  const baselineTotal = sumKnown(
    baselineLines.filter((l) => l.currency === cur).map((l) => plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) }).value),
  ).sum;
  const liveContracts = contracts.filter((c) => (c.status === "ACTIVE" || c.status === "COMPLETED") && c.currency === cur);
  const contractsTotal = sumKnown(liveContracts.map((c) => dec(c.currentAmount)));
  const signedActs = acts.filter((a) => effectiveActStatus(a) === "SIGNED");
  const actsSigned = sumKnown(signedActs.flatMap((a) => a.lines.map((l) => dec(l.amount)))).sum;

  const overall = summarize(null, "Проект", active);
  const forecastRows = active.filter((r) => r.forecast !== null);
  const tx = (k: string) => txGroups.find((g) => g.classification === k)?._count ?? 0;
  const openIssues = issues.reduce((n, i) => n + i._count, 0);
  const criticalIssues = issues.filter((i) => i.severity === "HIGH" || i.severity === "CRITICAL").reduce((n, i) => n + i._count, 0);
  const reviewBreakdown = {
    reviewContracts: contracts.filter((c) => c.flags.includes("PENDING_REVIEW")).length,
    recognitions: recs,
    pendingJobs,
    draftVersions,
    proposedTx: tx("PROPOSED"),
  };

  // Группы
  const groupBy = <K extends string | null>(key: (r: RegistryRowDTO) => K, defs: { id: K; name: string }[], noneName: string) => {
    const by = new Map<K, RegistryRowDTO[]>();
    for (const r of active) by.set(key(r), [...(by.get(key(r)) ?? []), r]);
    return [...defs, { id: null as K, name: noneName }].filter((d) => by.has(d.id)).map((d) => summarize(d.id, d.name, by.get(d.id)!));
  };
  const stageList = groupBy((r) => r.stageId, stages.map((x) => ({ id: x.id, name: `${x.code} — ${x.name}` })), "Без этапа");
  const objectList = groupBy((r) => r.objectId, objects.map((x) => ({ id: x.id, name: `${x.code} — ${x.name}` })), "Без корпуса");
  const sectionList = groupBy((r) => r.sectionId, sections.map((x) => ({ id: x.id, name: `${x.code} ${x.name}` })), "Без раздела");

  // Динамика по месяцам: подписанные АВР (по дате подписания) и затраты 1С (по дате операции)
  const actsByMonth = new Map<string, Decimal>();
  for (const a of signedActs) {
    const m = month(a.signedAt ?? a.date);
    actsByMonth.set(m, (actsByMonth.get(m) ?? new Decimal(0)).plus(sumKnown(a.lines.map((l) => dec(l.amount))).sum ?? 0));
  }
  const costByMonth = new Map<string, Decimal>();
  for (const t of costTx) {
    if (!t.date || !isCostTransaction(t)) continue;
    const m = month(t.date);
    costByMonth.set(m, (costByMonth.get(m) ?? new Decimal(0)).plus(dec(t.amount) ?? 0));
  }
  const series = (m: Map<string, Decimal>) => [...m].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([k, v]) => ({ month: k, value: v.toFixed(2) }));

  const warnings: string[] = [];
  if (!data.currentVersion) warnings.push("Нет утверждённой сметы");
  if (data.coverage.itemsWithoutPlannedCost) warnings.push(`Статей без плановой стоимости: ${data.coverage.itemsWithoutPlannedCost}`);
  if (overall.itemsWithoutProgress) warnings.push(`Нет данных о выполнении по ${overall.itemsWithoutProgress} статьям (${overall.dataCoverage ? (100 - Number(overall.dataCoverage)).toFixed(1) : "—"} % плановой стоимости)`);
  if (!data.project.costMethodologyConfirmed) warnings.push("Методика учёта затрат 1С не согласована — затраты и отклонения предварительные");
  if (!lastImport) warnings.push("Данные 1С ещё не импортировались");
  if (tx("UNCLASSIFIED") + tx("PROPOSED")) warnings.push(`Операций 1С без подтверждённой классификации: ${tx("UNCLASSIFIED") + tx("PROPOSED")}`);
  if (!data.project.forecastModelConfirmed) warnings.push("Модель прогноза не подтверждена — прогноз не рассчитывается");

  return {
    data,
    lastImport1C: lastImport?.createdAt ?? null,
    warnings,
    openIssues,
    criticalIssues,
    cards: {
      baselineTotal: s(baselineTotal),
      currentTotal: s(data.coverage.totalEstimate),
      contractsTotal: s(contractsTotal.sum),
      contractsCount: liveContracts.length,
      contractsIncomplete: liveContracts.filter((c) => c.currentAmount === null).length,
      coveragePercent: s(data.coverage.coveragePercent),
      uncoveredValue: s(data.coverage.uncoveredValue),
      weightedReadiness: overall.weightedPercent,
      readinessDataCoverage: overall.dataCoverage,
      earned: sumRows(active, (r) => r.earnedValue),
      actsSigned: s(actsSigned),
      accountingCost: sumRows(data.rows, (r) => r.accountingCost),
      paid: s(sumKnown(payments.map((p) => dec(p.amount))).sum),
      remainingCost: sumRows(active, (r) => r.remainingCost),
      forecast: forecastRows.length === active.length && active.length > 0 ? s(sumKnown(forecastRows.map((r) => dec(r.forecast))).sum) : null,
      forecastPartial: forecastRows.length > 0 && forecastRows.length < active.length ? forecastRows.length : 0,
      overdueCount: active.filter((r) => r.overdue).length,
      overrunCount: active.filter((r) => r.flags.some((f) => f.code === "COST_OVERRUN" || f.code === "COST_OVERRUN_PRELIMINARY")).length,
      overrunPreliminary: !data.project.costMethodologyConfirmed,
      uncoveredCount: active.filter((r) => !r.covered).length,
      reviewCount: Object.values(reviewBreakdown).reduce((a, b) => a + b, 0),
      reviewBreakdown,
      unallocatedTx: tx("UNCLASSIFIED") + unallocatedCost,
      unclassifiedTx: tx("UNCLASSIFIED"),
      unallocatedCost,
      coveredValue: s(data.coverage.coveredValue),
    },
    stages: stageList,
    objects: objectList,
    sections: sectionList,
    actsByMonth: series(actsByMonth),
    costByMonth: series(costByMonth),
    topDeviations: [...active.filter((r) => r.variance !== null && Number(r.variance) > 0)].sort((a, b) => Number(b.variance) - Number(a.variance)).slice(0, 8),
    uncoveredTop: [...active.filter((r) => !r.covered)].sort((a, b) => Number(b.plannedCost ?? 0) - Number(a.plannedCost ?? 0)).slice(0, 8),
    overdue: active.filter((r) => r.overdue).sort((a, b) => (a.plannedEndDate ?? "").localeCompare(b.plannedEndDate ?? "")).slice(0, 8),
    audit,
  };
}
