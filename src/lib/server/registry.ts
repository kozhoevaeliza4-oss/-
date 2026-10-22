import "server-only";
import { prisma } from "./db";
import { dec, Num } from "@/lib/calc/decimal";
import { computeRegistryRow, LEVEL_LABELS, RegistryRowResult, RowLevel } from "@/lib/calc/registryRow";
import { COVERAGE_LABELS, CoverageStatus, projectCoverage, ProjectCoverageResult } from "@/lib/calc/coverage";

const s = (v: Num): string | null => (v === null ? null : v.toString());

/** Сериализуемая строка реестра (для клиента, отчётов и экспорта). Числа — строками, null — нет данных. */
export interface RegistryRowDTO {
  id: string;
  code: string | null;
  name: string;
  sectionId: string | null;
  sectionName: string | null;
  objectId: string | null;
  objectName: string | null;
  stageId: string | null;
  stageName: string | null;
  unit: string | null;
  measurementType: "QUANTITY" | "PERCENT";
  origin: "ESTIMATE" | "MANUAL";
  active: boolean;
  plannedQuantity: string | null;
  unitPrice: string | null;
  plannedCost: string | null;
  plannedCostSource: string | null;
  baselinePlannedCost: string | null;
  contractors: string[];
  contracts: { id: string; number: string | null; date: string | null; status: string }[];
  contractAmount: string | null;
  contractAmountIncomplete: boolean;
  coverageStatus: CoverageStatus;
  coverageLabel: string;
  covered: boolean;
  contractVsPlan: string | null;
  actualQuantity: string | null;
  percentRaw: string | null;
  percentDisplay: string | null;
  overrunQuantity: string | null;
  overrunConfirmed: boolean;
  earnedValue: string | null;
  unconfirmedOverrunValue: string | null;
  actsAccepted: string | null;
  actsPending: string | null;
  documentedPercent: string | null;
  earnedVsActs: string | null;
  accountingCost: string | null;
  accountingCostLabel: string;
  paid: string | null;
  remainingQuantity: string | null;
  remainingCost: string | null;
  variance: string | null;
  variancePercent: string | null;
  varianceComparable: boolean;
  forecast: string | null;
  forecastReason: string | null;
  plannedEndDate: string | null;
  actualEndDate: string | null;
  overdue: boolean;
  comment: string | null;
  progressAsOf: string | null;
  updatedAt: string;
  sources: string[];
  level: RowLevel;
  levelLabel: string;
  flags: { level: string; code: string; text: string }[];
}

export interface RegistryData {
  project: {
    id: string;
    name: string;
    code: string;
    currency: string;
    isDemo: boolean;
    costMethodologyConfirmed: boolean;
    forecastModelConfirmed: boolean;
  };
  currentVersion: { id: string; name: string; versionNumber: number; approvedAt: string | null } | null;
  baselineVersion: { id: string; name: string; versionNumber: number } | null;
  rows: RegistryRowDTO[];
  coverage: ProjectCoverageResult;
  computedAt: string;
}

/**
 * Загрузка и расчёт реестра работ проекта. Все показатели вычисляются через computeRegistryRow.
 */
export async function loadRegistry(projectId: string, opts: { workItemId?: string; today?: Date } = {}): Promise<RegistryData> {
  const today = opts.today ?? new Date();
  const only = opts.workItemId;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const [current, baseline] = await Promise.all([
    prisma.estimateVersion.findFirst({ where: { projectId, status: "ACTIVE" } }),
    prisma.estimateVersion.findFirst({ where: { projectId, isBaseline: true } }),
  ]);

  const [items, currentLines, baselineLines, progress, allocations, actLines, costAllocs] = await Promise.all([
    prisma.workItem.findMany({
      where: { projectId, ...(only ? { id: only } : {}) },
      include: { object: true, stage: true, section: true },
      orderBy: [{ section: { sortOrder: "asc" } }, { code: "asc" }, { name: "asc" }],
    }),
    current ? prisma.estimateLine.findMany({ where: { versionId: current.id, workItemId: only ?? { not: null } } }) : [],
    baseline ? prisma.estimateLine.findMany({ where: { versionId: baseline.id, workItemId: only ?? { not: null } } }) : [],
    // Текущее значение выполнения — последняя запись истории по дате фиксации
    prisma.workProgressRecord.findMany({
      where: { workItem: { projectId }, ...(only ? { workItemId: only } : {}) },
      distinct: ["workItemId"],
      orderBy: [{ workItemId: "asc" }, { asOfDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.contractWorkAllocation.findMany({
      where: { workItem: { projectId }, ...(only ? { workItemId: only } : {}) },
      include: { contract: { include: { contractor: true } } },
    }),
    prisma.actLine.findMany({
      where: { workItemId: only ?? { not: null }, act: { projectId } },
      include: { act: { select: { status: true, currency: true } } },
    }),
    prisma.transactionAllocation.findMany({
      where: { workItemId: only ?? { not: null }, transaction: { projectId } },
      include: { transaction: { select: { classification: true, currency: true } } },
    }),
  ]);

  const byItem = <T,>(rows: T[], key: (r: T) => string | null) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      const arr = m.get(k);
      if (arr) arr.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const curLineMap = new Map(currentLines.map((l) => [l.workItemId!, l]));
  const baseLineMap = new Map(baselineLines.map((l) => [l.workItemId!, l]));
  const progressMap = new Map(progress.map((p) => [p.workItemId, p]));
  const allocMap = byItem(allocations, (a) => a.workItemId);
  const actMap = byItem(actLines, (a) => a.workItemId);
  const costMap = byItem(costAllocs, (a) => a.workItemId);

  const rows: RegistryRowDTO[] = [];
  const results: RegistryRowResult[] = [];

  for (const it of items) {
    const cl = curLineMap.get(it.id) ?? null;
    const bl = baseLineMap.get(it.id) ?? null;
    const pr = progressMap.get(it.id) ?? null;
    const allocs = allocMap.get(it.id) ?? [];
    const r = computeRegistryRow({
      currency: project.currency,
      today,
      measurementType: it.measurementType,
      currentPlan: cl
        ? { quantity: dec(cl.quantity), unitPrice: dec(cl.unitPrice), sourceTotal: dec(cl.sourceTotal), currency: cl.currency }
        : null,
      baselinePlan: bl
        ? { quantity: dec(bl.quantity), unitPrice: dec(bl.unitPrice), sourceTotal: dec(bl.sourceTotal), currency: bl.currency }
        : null,
      progress: pr
        ? { quantity: dec(pr.quantity), percent: dec(pr.percent), overrunConfirmed: pr.overrunConfirmed, asOfDate: pr.asOfDate }
        : null,
      allocations: allocs.map((a) => ({
        contractId: a.contractId,
        allocationStatus: a.status,
        contractStatus: a.contract.status,
        amount: dec(a.amount),
        quantity: dec(a.quantity),
        currency: a.contract.currency,
      })),
      actLines: (actMap.get(it.id) ?? []).map((l) => ({ amount: dec(l.amount), status: l.act.status, currency: l.act.currency })),
      costAllocations: (costMap.get(it.id) ?? []).map((c) => ({
        amount: dec(c.amount),
        classified: c.transaction.classification === "CLASSIFIED",
        currency: c.transaction.currency,
      })),
      // Оплаты привязываются к договорам; на уровне статьи без распределения не показываются.
      payments: [],
      plannedEndDate: it.plannedEndDate,
      actualEndDate: it.actualEndDate,
      forecastRemainingCost: dec(it.forecastRemainingCost),
      methodologyConfirmed: project.costMethodologyConfirmed,
      forecastModelConfirmed: project.forecastModelConfirmed,
    });
    results.push(r);

    const liveAllocs = allocs.filter((a) => a.status !== "REJECTED");
    const sources: string[] = [];
    if (cl) sources.push(`Смета v${current!.versionNumber}${cl.sourceRow ? `, ${cl.sourceSheet ?? "лист"}: стр. ${cl.sourceRow}` : ""}`);
    else if (it.origin === "MANUAL") sources.push("Статья добавлена вручную");
    if (pr) sources.push(`Выполнение: ${pr.source === "MANUAL" ? "ручной ввод" : pr.source === "EXCEL_IMPORT" ? "импорт Excel" : "документ"} от ${pr.asOfDate.toISOString().slice(0, 10)}`);

    rows.push({
      id: it.id,
      code: it.code,
      name: it.name,
      sectionId: it.sectionId,
      sectionName: it.section ? `${it.section.code} ${it.section.name}`.trim() : null,
      objectId: it.objectId,
      objectName: it.object?.name ?? null,
      stageId: it.stageId,
      stageName: it.stage?.name ?? null,
      unit: it.unit,
      measurementType: it.measurementType,
      origin: it.origin,
      active: r.active,
      plannedQuantity: s(r.plannedQuantity),
      unitPrice: s(r.unitPrice),
      plannedCost: s(r.plan?.value ?? null),
      plannedCostSource: r.plan?.source ?? null,
      baselinePlannedCost: s(r.baselinePlannedCost),
      contractors: [...new Set(liveAllocs.map((a) => a.contract.contractor?.name).filter((x): x is string => !!x))],
      contracts: liveAllocs.map((a) => ({
        id: a.contract.id,
        number: a.contract.number,
        date: a.contract.date ? a.contract.date.toISOString().slice(0, 10) : null,
        status: a.contract.status,
      })),
      contractAmount: s(r.coverage.contractAmount),
      contractAmountIncomplete: r.coverage.contractAmountIncomplete,
      coverageStatus: r.coverage.status,
      coverageLabel: COVERAGE_LABELS[r.coverage.status],
      covered: r.coverage.covered,
      contractVsPlan: s(r.coverage.contractVsPlan),
      actualQuantity: s(r.progress.doneQuantity),
      percentRaw: s(r.progress.percentRaw),
      percentDisplay: s(r.progress.percentDisplay),
      overrunQuantity: s(r.progress.overrunQuantity),
      overrunConfirmed: r.progress.overrunConfirmed,
      earnedValue: s(r.earned.value),
      unconfirmedOverrunValue: s(r.earned.unconfirmedOverrunValue),
      actsAccepted: s(r.acts.accepted),
      actsPending: s(r.acts.pending),
      documentedPercent: s(r.documentedPercent),
      earnedVsActs: s(r.reconciliation.difference),
      accountingCost: s(r.cost.value),
      accountingCostLabel: r.cost.label,
      paid: s(r.paid),
      remainingQuantity: s(r.progress.remainingQuantity),
      remainingCost: s(r.earned.remainingCost),
      variance: s(r.variance.value),
      variancePercent: s(r.variance.percent),
      varianceComparable: r.variance.comparable,
      forecast: s(r.forecast.value),
      forecastReason: r.forecast.reason,
      plannedEndDate: it.plannedEndDate ? it.plannedEndDate.toISOString().slice(0, 10) : null,
      actualEndDate: it.actualEndDate ? it.actualEndDate.toISOString().slice(0, 10) : null,
      overdue: r.overdue,
      comment: it.comment,
      progressAsOf: pr ? pr.asOfDate.toISOString().slice(0, 10) : null,
      updatedAt: (pr && pr.createdAt > it.updatedAt ? pr.createdAt : it.updatedAt).toISOString(),
      sources,
      level: r.level,
      levelLabel: LEVEL_LABELS[r.level],
      flags: r.flags,
    });
  }

  const coverage = projectCoverage(results.map((r) => ({ plannedCost: r.plan?.value ?? null, covered: r.coverage.covered, active: r.active })));

  return {
    project: {
      id: project.id,
      name: project.name,
      code: project.code,
      currency: project.currency,
      isDemo: project.isDemo,
      costMethodologyConfirmed: project.costMethodologyConfirmed,
      forecastModelConfirmed: project.forecastModelConfirmed,
    },
    currentVersion: current
      ? { id: current.id, name: current.name, versionNumber: current.versionNumber, approvedAt: current.approvedAt?.toISOString() ?? null }
      : null,
    baselineVersion: baseline ? { id: baseline.id, name: baseline.name, versionNumber: baseline.versionNumber } : null,
    rows,
    coverage,
    computedAt: new Date().toISOString(),
  };
}
