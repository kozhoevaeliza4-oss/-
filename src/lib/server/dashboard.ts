import "server-only";
import { prisma } from "./db";
import { loadRegistry, RegistryData, RegistryRowDTO } from "./registry";
import { dec, Num, percentOf, sumKnown } from "@/lib/calc/decimal";
import { contractCurrentAmount, COVERING_CONTRACT_STATUSES } from "@/lib/calc/coverage";
import { plannedCost } from "@/lib/calc/workItem";

const s = (v: Num) => (v === null ? null : v.toString());
const sumRows = (rows: RegistryRowDTO[], pick: (r: RegistryRowDTO) => string | null) => {
  const r = sumKnown(rows.map((x) => dec(pick(x))));
  return { sum: s(r.sum), missing: r.missing };
};

export interface StageSummary {
  id: string | null;
  name: string;
  items: number;
  plannedCost: string | null;
  earned: string | null;
  acts: string | null;
  cost: string | null;
  /** Физическая готовность этапа, взвешенная по плановой стоимости = Σ выполненного / Σ плана */
  weightedPercent: string | null;
  itemsWithoutPlan: number;
  itemsWithoutProgress: number;
}

export async function loadDashboard(projectId: string) {
  const data: RegistryData = await loadRegistry(projectId);
  const cur = data.project.currency;
  const active = data.rows.filter((r) => r.active);

  const [baselineLines, contracts, signedActLines, payments, unclassified, reviewContracts, pendingJobs, draftVersions, audit, stages] =
    await Promise.all([
      data.baselineVersion ? prisma.estimateLine.findMany({ where: { versionId: data.baselineVersion.id } }) : Promise.resolve([]),
      prisma.contract.findMany({ where: { projectId, status: { in: COVERING_CONTRACT_STATUSES } }, include: { amendments: true } }),
      prisma.actLine.findMany({ where: { act: { projectId, status: "SIGNED", currency: cur } }, select: { amount: true } }),
      prisma.payment.findMany({ where: { projectId, currency: cur }, select: { amount: true } }),
      prisma.accountingTransaction.count({ where: { projectId, classification: "UNCLASSIFIED" } }),
      prisma.contract.count({ where: { projectId, status: { in: ["UPLOADED_NEEDS_REVIEW", "NEEDS_CLARIFICATION"] } } }),
      prisma.importJob.count({ where: { projectId, status: "PARSED" } }),
      prisma.estimateVersion.count({ where: { projectId, status: "DRAFT" } }),
      prisma.auditLog.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 15, include: { user: { select: { name: true } } } }),
      prisma.constructionStage.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    ]);

  const baselineTotal = sumKnown(
    baselineLines
      .filter((l) => l.currency === cur)
      .map((l) => plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) }).value),
  ).sum;

  // Сумма договоров: каждый договор учитывается один раз (без распределения по статьям)
  const contractAmounts = contracts
    .filter((c) => (c.currency ?? cur) === cur)
    .map((c) => contractCurrentAmount({ totalAmount: dec(c.totalAmount), amendmentDeltas: c.amendments.filter((a) => a.isSigned).map((a) => dec(a.amountDelta)) }));
  const contractsTotal = sumKnown(contractAmounts.map((c) => c.value));

  // По этапам
  const byStage = new Map<string | null, RegistryRowDTO[]>();
  for (const r of active) byStage.set(r.stageId, [...(byStage.get(r.stageId) ?? []), r]);
  const stageList: StageSummary[] = [...stages.map((st) => ({ id: st.id as string | null, name: `${st.code} — ${st.name}` })), { id: null, name: "Без этапа" }]
    .filter((st) => byStage.has(st.id))
    .map((st) => {
      const rows = byStage.get(st.id)!;
      const withPlan = rows.filter((r) => r.plannedCost !== null);
      const planned = sumKnown(withPlan.map((r) => dec(r.plannedCost))).sum;
      // Статьи без внесённого выполнения в сумму выполненного не входят (их число показывается отдельно)
      const earned = sumKnown(withPlan.map((r) => dec(r.earnedValue))).sum;
      return {
        id: st.id,
        name: st.name,
        items: rows.length,
        plannedCost: s(planned),
        earned: s(earned),
        acts: sumRows(rows, (r) => r.actsAccepted).sum,
        cost: sumRows(rows, (r) => r.accountingCost).sum,
        weightedPercent: s(percentOf(earned, planned)),
        itemsWithoutPlan: rows.length - withPlan.length,
        itemsWithoutProgress: withPlan.filter((r) => r.earnedValue === null).length,
      };
    });

  const hasFlag = (r: RegistryRowDTO, codes: string[]) => r.flags.some((f) => codes.includes(f.code));
  const overrunRows = active.filter((r) => hasFlag(r, ["COST_OVERRUN", "COST_OVERRUN_PRELIMINARY"]));
  const uncovered = active.filter((r) => !r.covered);

  return {
    data,
    cards: {
      baselineTotal: s(baselineTotal),
      currentTotal: s(data.coverage.totalEstimate),
      contractsTotal: s(contractsTotal.sum),
      contractsCount: contracts.length,
      contractsIncomplete: contractAmounts.filter((c) => c.incomplete).length,
      coveragePercent: s(data.coverage.coveragePercent),
      uncoveredValue: s(data.coverage.uncoveredValue),
      earned: sumRows(active, (r) => r.earnedValue),
      actsSigned: s(sumKnown(signedActLines.map((l) => dec(l.amount))).sum),
      accountingCost: sumRows(data.rows, (r) => r.accountingCost),
      paid: s(sumKnown(payments.map((p) => dec(p.amount))).sum),
      remainingCost: sumRows(active, (r) => r.remainingCost),
      overrunCount: overrunRows.length,
      overrunPreliminary: overrunRows.some((r) => !r.varianceComparable),
      uncoveredCount: uncovered.length,
      reviewCount: reviewContracts + pendingJobs + draftVersions + unclassified,
      reviewBreakdown: { reviewContracts, pendingJobs, draftVersions, unclassified },
      itemsWithoutPlannedCost: data.coverage.itemsWithoutPlannedCost,
    },
    stages: stageList,
    topOverruns: [...active.filter((r) => r.variance !== null && Number(r.variance) > 0)].sort((a, b) => Number(b.variance) - Number(a.variance)).slice(0, 10),
    uncoveredTop: [...uncovered].sort((a, b) => Number(b.plannedCost ?? 0) - Number(a.plannedCost ?? 0)).slice(0, 10),
    overdue: active.filter((r) => r.overdue).sort((a, b) => (a.plannedEndDate ?? "").localeCompare(b.plannedEndDate ?? "")).slice(0, 10),
    audit,
  };
}
