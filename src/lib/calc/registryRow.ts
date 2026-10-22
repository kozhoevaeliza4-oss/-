/**
 * Полный расчёт строки реестра работ: объединяет смету, договоры, выполнение, АВР, 1С и оплаты.
 * Единственное место, где строка реестра вычисляется, — интерфейс, отчёты и экспорт используют только его.
 */
import { CALC_CONFIG } from "./config";
import {
  AllocationInput,
  CoverageStatus,
  ItemCoverageResult,
  itemCoverage,
} from "./coverage";
import { Num, sumKnown } from "./decimal";
import {
  AccountingCostResult,
  ActLineInput,
  ActsResult,
  CostAllocationInput,
  EarnedValueResult,
  ForecastResult,
  MeasurementType,
  PlannedCostResult,
  ProgressResult,
  ReconciliationResult,
  VarianceResult,
  accountingCost,
  actsSummary,
  computeProgress,
  costVariance,
  documentedPercent,
  earnedValue,
  forecastAtCompletion,
  plannedCost,
  reconcileEarnedVsActs,
} from "./workItem";

export interface PlanLineInput {
  quantity: Num;
  unitPrice: Num;
  sourceTotal: Num;
  currency: string;
}

export interface RegistryRowInput {
  currency: string;
  today: Date;
  measurementType: MeasurementType;
  /** Строка текущей утверждённой версии сметы; null — статьи нет в действующей смете */
  currentPlan: PlanLineInput | null;
  /** Строка первоначальной (базовой) сметы */
  baselinePlan: PlanLineInput | null;
  progress: {
    quantity: Num;
    percent: Num;
    overrunConfirmed: boolean;
    asOfDate: Date | null;
  } | null;
  allocations: AllocationInput[];
  actLines: ActLineInput[];
  costAllocations: CostAllocationInput[];
  payments: { amount: Num; currency: string }[];
  plannedEndDate: Date | null;
  actualEndDate: Date | null;
  forecastRemainingCost: Num;
  methodologyConfirmed: boolean;
  forecastModelConfirmed: boolean;
}

export type RowLevel = "green" | "yellow" | "red" | "grey";

export const LEVEL_LABELS: Record<RowLevel, string> = {
  green: "Подтверждено",
  yellow: "Требуется проверка",
  red: "Требует внимания",
  grey: "Недостаточно данных",
};

export interface RowFlag {
  level: Exclude<RowLevel, "green">;
  code: string;
  text: string;
}

export interface RegistryRowResult {
  active: boolean;
  plan: PlannedCostResult | null;
  baselinePlannedCost: Num;
  plannedQuantity: Num;
  unitPrice: Num;
  progress: ProgressResult;
  earned: EarnedValueResult;
  coverage: ItemCoverageResult;
  acts: ActsResult;
  documentedPercent: Num;
  reconciliation: ReconciliationResult;
  cost: AccountingCostResult;
  variance: VarianceResult;
  paid: Num;
  forecast: ForecastResult;
  overdue: boolean;
  deadlineSoon: boolean;
  level: RowLevel;
  flags: RowFlag[];
}

export function computeRegistryRow(input: RegistryRowInput): RegistryRowResult {
  const cur = input.currentPlan;
  const flags: RowFlag[] = [];

  let plan: PlannedCostResult | null = null;
  if (cur) {
    if (cur.currency !== input.currency) {
      flags.push({ level: "grey", code: "PLAN_CURRENCY", text: `Валюта сметы (${cur.currency}) отличается от валюты проекта` });
    } else {
      plan = plannedCost(cur);
    }
  }
  const baseline =
    input.baselinePlan && input.baselinePlan.currency === input.currency ? plannedCost(input.baselinePlan).value : null;
  const plannedQuantity = cur?.quantity ?? null;
  const unitPrice = plan ? cur?.unitPrice ?? null : null;
  const plannedCostValue = plan?.value ?? null;

  const progress = computeProgress({
    measurementType: input.measurementType,
    plannedQuantity,
    actualQuantity: input.progress?.quantity ?? null,
    manualPercent: input.progress?.percent ?? null,
    overrunConfirmed: input.progress?.overrunConfirmed ?? false,
  });
  const earned = earnedValue({
    measurementType: input.measurementType,
    progress,
    plannedQuantity,
    unitPrice,
    plannedCost: plannedCostValue,
  });

  const coverage = itemCoverage({
    allocations: input.allocations,
    plannedCost: plannedCostValue,
    plannedQuantity,
    currency: input.currency,
  });
  const acts = actsSummary(input.actLines, input.currency);
  const docPct = documentedPercent(acts.accepted, plannedCostValue);
  const reconciliation = reconcileEarnedVsActs(earned.value, acts.accepted);
  const cost = accountingCost(input.costAllocations, input.currency, input.methodologyConfirmed);
  const variance = costVariance({
    actualCost: cost.value,
    earnedValue: earned.value,
    methodologyConfirmed: input.methodologyConfirmed,
  });
  const paid = sumKnown(input.payments.filter((p) => p.currency === input.currency).map((p) => p.amount)).sum;
  const forecast = forecastAtCompletion({
    actualCost: cost.value,
    forecastRemainingCost: input.forecastRemainingCost,
    modelConfirmed: input.forecastModelConfirmed,
  });

  // ── Сроки
  const complete =
    input.actualEndDate !== null || (progress.percentRaw !== null && progress.percentRaw.gte(100));
  const today = startOfDay(input.today);
  const overdue = !complete && input.plannedEndDate !== null && startOfDay(input.plannedEndDate) < today;
  const soonLimit = new Date(today);
  soonLimit.setDate(soonLimit.getDate() + CALC_CONFIG.deadlineWarningDays);
  const deadlineSoon = !complete && !overdue && input.plannedEndDate !== null && startOfDay(input.plannedEndDate) <= soonLimit;

  // ── Флаги
  const active = cur !== null;
  if (!active) flags.push({ level: "grey", code: "NOT_IN_ESTIMATE", text: "Статья отсутствует в действующей смете" });
  else if (plannedCostValue === null) flags.push({ level: "grey", code: "NO_PLAN_COST", text: "Нет плановой стоимости" });
  if (input.measurementType === "QUANTITY" && active && (plannedQuantity === null || plannedQuantity.isZero()))
    flags.push({ level: "grey", code: "NO_PLAN_QTY", text: "Нет данных для расчёта: плановый объём не задан" });
  if (plan?.hasDiscrepancy)
    flags.push({ level: "yellow", code: "ESTIMATE_DISCREPANCY", text: "Итог сметы не равен объёму × цене" });
  if (earned.derivedPrice)
    flags.push({ level: "yellow", code: "DERIVED_PRICE", text: "Цена за единицу рассчитана как плановая стоимость / объём" });

  if (overdue) flags.push({ level: "red", code: "OVERDUE", text: "Просрочен плановый срок завершения" });
  else if (deadlineSoon) flags.push({ level: "yellow", code: "DEADLINE_SOON", text: "Приближается плановый срок завершения" });

  const started = progress.percentRaw !== null && progress.percentRaw.gt(0);
  if (active && !coverage.covered) {
    if (started) flags.push({ level: "red", code: "WORK_WITHOUT_CONTRACT", text: "Работы выполняются без подтверждённого договора" });
    else if (coverage.status === "NONE") flags.push({ level: "yellow", code: "NO_CONTRACT", text: "Договор отсутствует" });
  }
  if (coverage.status === "NEEDS_REVIEW" || coverage.status === "NEEDS_CLARIFICATION")
    flags.push({ level: "yellow", code: "CONTRACT_REVIEW", text: "Договорное покрытие требует проверки" });
  if (coverage.partialVolume) flags.push({ level: "yellow", code: "PARTIAL_VOLUME", text: "Договоры покрывают не весь плановый объём" });
  if (coverage.contractVsPlan !== null && coverage.contractVsPlan.gt(CALC_CONFIG.estimateTotalTolerance))
    flags.push({ level: "yellow", code: "CONTRACT_OVER_PLAN", text: "Сумма договоров превышает плановую стоимость" });
  if (coverage.coveringContracts > 1)
    flags.push({ level: "yellow", code: "MULTIPLE_CONTRACTS", text: "Статья покрыта несколькими договорами" });

  if (progress.overrunQuantity !== null) {
    flags.push(
      progress.overrunConfirmed
        ? { level: "yellow", code: "OVERRUN_CONFIRMED", text: "Подтверждено превышение планового объёма" }
        : { level: "red", code: "OVERRUN_UNCONFIRMED", text: "Факт превышает плановый объём, превышение не подтверждено" },
    );
  }
  if (progress.percentRaw !== null && progress.percentRaw.lt(0))
    flags.push({ level: "red", code: "NEGATIVE_PROGRESS", text: "Отрицательный фактический объём — ошибка данных" });

  if (reconciliation.needsReconciliation && reconciliation.message)
    flags.push({ level: "yellow", code: "RECONCILE_ACTS", text: reconciliation.message });
  if (acts.foreignCurrencyLines > 0)
    flags.push({ level: "yellow", code: "ACT_CURRENCY", text: "Есть строки АВР в другой валюте — не включены в сумму" });

  if (variance.value !== null && variance.percent !== null && variance.percent.gt(CALC_CONFIG.significantVariancePercent)) {
    flags.push(
      variance.comparable
        ? { level: "red", code: "COST_OVERRUN", text: "Существенное превышение затрат над плановой стоимостью выполненного" }
        : { level: "yellow", code: "COST_OVERRUN_PRELIMINARY", text: "Предварительное превышение затрат (методика 1С не подтверждена)" },
    );
  }

  return {
    active,
    plan,
    baselinePlannedCost: baseline,
    plannedQuantity,
    unitPrice,
    progress,
    earned,
    coverage,
    acts,
    documentedPercent: docPct,
    reconciliation,
    cost,
    variance,
    paid,
    forecast,
    overdue,
    deadlineSoon,
    level: rowLevel(flags),
    flags,
  };
}

function rowLevel(flags: RowFlag[]): RowLevel {
  if (flags.some((f) => f.level === "red")) return "red";
  if (flags.some((f) => f.level === "yellow")) return "yellow";
  if (flags.some((f) => f.level === "grey")) return "grey";
  return "green";
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export type { CoverageStatus };
