/**
 * Расчёты по статье работ (пп. 5.1–5.7 ТЗ). Чистые функции без доступа к БД.
 *
 * Показатели строго разделены:
 *  - физическая готовность (объём / процент);
 *  - расчётная стоимость физически выполненного объёма;
 *  - стоимость, принятая по подписанным АВР;
 *  - импортированные затраты 1С;
 *  - оплаты.
 * Один показатель никогда не подменяет другой.
 */
import { CALC_CONFIG } from "./config";
import { Decimal, HUNDRED, Num, ZERO, clamp, mul, percentOf, safeDiv, sub, sumKnown } from "./decimal";

// ───────────── Плановая стоимость строки сметы ─────────────

export type PlannedCostSource = "SOURCE_TOTAL" | "COMPUTED";

export interface PlannedCostResult {
  /** Плановая стоимость: итог исходной сметы, а при его отсутствии — объём × цена. */
  value: Num;
  source: PlannedCostSource | null;
  /** Объём × цена (если оба известны) */
  computed: Num;
  /** Итог исходной сметы − объём × цена */
  discrepancy: Num;
  hasDiscrepancy: boolean;
}

export function plannedCost(input: { quantity: Num; unitPrice: Num; sourceTotal: Num }): PlannedCostResult {
  const computed = mul(input.quantity, input.unitPrice);
  if (input.sourceTotal !== null) {
    const discrepancy = computed === null ? null : input.sourceTotal.minus(computed);
    return {
      value: input.sourceTotal,
      source: "SOURCE_TOTAL",
      computed,
      discrepancy,
      hasDiscrepancy: discrepancy !== null && discrepancy.abs().gt(CALC_CONFIG.estimateTotalTolerance),
    };
  }
  return { value: computed, source: computed === null ? null : "COMPUTED", computed, discrepancy: null, hasDiscrepancy: false };
}

/** Цена за единицу для оценки выполненного: из сметы, иначе производная (стоимость / объём). */
export function effectiveUnitPrice(input: { unitPrice: Num; plannedCost: Num; plannedQuantity: Num }): {
  value: Num;
  derived: boolean;
} {
  if (input.unitPrice !== null) return { value: input.unitPrice, derived: false };
  const d = safeDiv(input.plannedCost, input.plannedQuantity);
  return { value: d, derived: d !== null };
}

// ───────────── Физическая готовность (5.1) ─────────────

export type MeasurementType = "QUANTITY" | "PERCENT";

export interface ProgressInput {
  measurementType: MeasurementType;
  plannedQuantity: Num;
  /** Накопленный фактический подтверждённый объём (последняя запись истории) */
  actualQuantity: Num;
  /** Подтверждённый процент готовности (для неизмеримых работ) */
  manualPercent: Num;
  /** Превышение плана подтверждено (доп. объёмы / изменения проекта) */
  overrunConfirmed: boolean;
}

export type ProgressStatus = "OK" | "NO_ACTUAL" | "NO_PLAN";

export interface ProgressResult {
  status: ProgressStatus;
  /** Процент без ограничения (может быть > 100 или < 0) */
  percentRaw: Num;
  /** Процент для отображения: 0..100, выше 100 — только при подтверждённом превышении */
  percentDisplay: Num;
  /** Фактический объём (для PERCENT — эквивалент от планового объёма, если он известен) */
  doneQuantity: Num;
  /** Объём, учитываемый в стоимости: при неподтверждённом превышении ограничен плановым */
  creditedQuantity: Num;
  /** Превышение планового объёма (> 0), иначе null */
  overrunQuantity: Num;
  overrunConfirmed: boolean;
  /** Остаток объёма = план − факт (может быть отрицательным — не скрывается) */
  remainingQuantity: Num;
  /** Процент, учитываемый в стоимости (для PERCENT) */
  creditedPercent: Num;
}

export function computeProgress(input: ProgressInput): ProgressResult {
  const empty: ProgressResult = {
    status: "NO_ACTUAL",
    percentRaw: null,
    percentDisplay: null,
    doneQuantity: null,
    creditedQuantity: null,
    overrunQuantity: null,
    overrunConfirmed: input.overrunConfirmed,
    remainingQuantity: null,
    creditedPercent: null,
  };

  if (input.measurementType === "PERCENT") {
    const p = input.manualPercent;
    if (p === null) return { ...empty, remainingQuantity: null };
    const over = p.gt(HUNDRED);
    const creditedPercent = over && !input.overrunConfirmed ? HUNDRED : Decimal.max(ZERO, p);
    const doneQuantity = input.plannedQuantity === null ? null : input.plannedQuantity.times(p).div(HUNDRED);
    const overrunQuantity =
      over && input.plannedQuantity !== null ? input.plannedQuantity.times(p.minus(HUNDRED)).div(HUNDRED) : null;
    return {
      status: "OK",
      percentRaw: p,
      percentDisplay: displayPercent(p, input.overrunConfirmed),
      doneQuantity,
      creditedQuantity: input.plannedQuantity === null ? null : input.plannedQuantity.times(creditedPercent).div(HUNDRED),
      overrunQuantity,
      overrunConfirmed: input.overrunConfirmed,
      remainingQuantity: input.plannedQuantity === null || doneQuantity === null ? null : input.plannedQuantity.minus(doneQuantity),
      creditedPercent,
    };
  }

  // QUANTITY
  const actual = input.actualQuantity;
  const planned = input.plannedQuantity;
  if (actual === null) {
    return { ...empty, status: planned === null || planned.isZero() ? "NO_PLAN" : "NO_ACTUAL" };
  }
  const remainingQuantity = sub(planned, actual);
  const overrunQuantity = planned !== null && actual.gt(planned) ? actual.minus(planned) : null;
  const creditedQuantity =
    planned !== null && overrunQuantity !== null && !input.overrunConfirmed ? planned : actual;
  const percentRaw = percentOf(actual, planned);
  if (percentRaw === null) {
    // Плановый объём нулевой или отсутствует — деление не выполняется.
    return {
      ...empty,
      status: "NO_PLAN",
      doneQuantity: actual,
      creditedQuantity: actual,
      remainingQuantity,
    };
  }
  return {
    status: "OK",
    percentRaw,
    percentDisplay: displayPercent(percentRaw, input.overrunConfirmed),
    doneQuantity: actual,
    creditedQuantity,
    overrunQuantity,
    overrunConfirmed: input.overrunConfirmed,
    remainingQuantity,
    creditedPercent: percentOf(creditedQuantity, planned),
  };
}

function displayPercent(raw: Decimal, overrunConfirmed: boolean): Decimal {
  if (overrunConfirmed && raw.gt(HUNDRED)) return raw;
  return clamp(raw, ZERO, HUNDRED);
}

// ───────────── Стоимость выполненного и остатки (5.2, 5.3) ─────────────

export interface EarnedValueResult {
  /** Расчётная стоимость выполненного объёма (по плановым расценкам) */
  value: Num;
  method: "QUANTITY_X_PRICE" | "PERCENT_OF_PLANNED_COST" | null;
  /** Цена получена делением плановой стоимости на объём (в смете нет цены за единицу) */
  derivedPrice: boolean;
  /** Стоимость неподтверждённого превышения — показывается отдельно, в выполненное не входит */
  unconfirmedOverrunValue: Num;
  /** Остаток плановой стоимости = плановая стоимость − расчётная стоимость выполненного */
  remainingCost: Num;
}

export function earnedValue(input: {
  measurementType: MeasurementType;
  progress: ProgressResult;
  plannedQuantity: Num;
  unitPrice: Num;
  plannedCost: Num;
}): EarnedValueResult {
  const p = input.progress;
  if (input.measurementType === "PERCENT") {
    if (p.creditedPercent === null || input.plannedCost === null) {
      return { value: null, method: null, derivedPrice: false, unconfirmedOverrunValue: null, remainingCost: null };
    }
    const value = input.plannedCost.times(p.creditedPercent).div(HUNDRED);
    const overPct = p.percentRaw !== null && p.percentRaw.gt(HUNDRED) && !p.overrunConfirmed ? p.percentRaw.minus(HUNDRED) : null;
    return {
      value,
      method: "PERCENT_OF_PLANNED_COST",
      derivedPrice: false,
      unconfirmedOverrunValue: overPct === null ? null : input.plannedCost.times(overPct).div(HUNDRED),
      remainingCost: input.plannedCost.minus(value),
    };
  }

  const price = effectiveUnitPrice({
    unitPrice: input.unitPrice,
    plannedCost: input.plannedCost,
    plannedQuantity: input.plannedQuantity,
  });
  const value = mul(p.creditedQuantity, price.value);
  const unconfirmedOverrunValue =
    p.overrunQuantity !== null && !p.overrunConfirmed ? mul(p.overrunQuantity, price.value) : null;
  return {
    value,
    method: value === null ? null : "QUANTITY_X_PRICE",
    derivedPrice: price.derived,
    unconfirmedOverrunValue,
    remainingCost: sub(input.plannedCost, value),
  };
}

// ───────────── АВР (5.4) ─────────────

export type ActStatus = "DRAFT" | "ON_APPROVAL" | "SIGNED" | "REJECTED";

export interface ActLineInput {
  amount: Num;
  status: ActStatus;
  currency: string;
}

export interface ActsResult {
  /** Сумма принятых работ: только подписанные акты, включая корректировочные/сторно (со своим знаком) */
  accepted: Num;
  /** Подготовленные и на согласовании — не являются принятой стоимостью */
  pending: Num;
  signedCount: number;
  pendingCount: number;
  /** Строки в другой валюте — исключены из суммы */
  foreignCurrencyLines: number;
}

export function actsSummary(lines: ActLineInput[], currency: string): ActsResult {
  const signed: Num[] = [];
  const pending: Num[] = [];
  let foreign = 0;
  for (const l of lines) {
    if (l.currency !== currency) {
      foreign++;
      continue;
    }
    if (l.status === "SIGNED") signed.push(l.amount);
    else if (l.status === "DRAFT" || l.status === "ON_APPROVAL") pending.push(l.amount);
  }
  return {
    accepted: sumKnown(signed).sum,
    pending: sumKnown(pending).sum,
    signedCount: signed.length,
    pendingCount: pending.length,
    foreignCurrencyLines: foreign,
  };
}

/** Процент документального подтверждения = принято по АВР / плановая стоимость. НЕ физическая готовность. */
export function documentedPercent(accepted: Num, plannedCostValue: Num): Num {
  return percentOf(accepted, plannedCostValue);
}

export interface ReconciliationResult {
  /** Расчётная стоимость выполненного − принято по АВР */
  difference: Num;
  needsReconciliation: boolean;
  message: string | null;
}

/**
 * Сверка физического выполнения и АВР. Разница — повод для сверки,
 * а не автоматическая задолженность перед подрядчиком.
 */
export function reconcileEarnedVsActs(earned: Num, accepted: Num): ReconciliationResult {
  if (earned === null) return { difference: null, needsReconciliation: false, message: null };
  const acc = accepted ?? null;
  if (acc === null) {
    if (earned.gt(CALC_CONFIG.reconciliationTolerance)) {
      return {
        difference: null,
        needsReconciliation: true,
        message: "Работы выполнены, подписанных АВР нет — требуется сверка",
      };
    }
    return { difference: null, needsReconciliation: false, message: null };
  }
  const difference = earned.minus(acc);
  if (difference.abs().lte(CALC_CONFIG.reconciliationTolerance)) {
    return { difference, needsReconciliation: false, message: null };
  }
  return {
    difference,
    needsReconciliation: true,
    message: difference.gt(0)
      ? "Расчётная стоимость выполненного превышает принятое по АВР — требуется сверка (не является автоматически задолженностью)"
      : "Принято по АВР больше расчётной стоимости физически выполненного — требуется сверка",
  };
}

// ───────────── Затраты 1С и отклонение (5.5, 5.6) ─────────────

export interface CostAllocationInput {
  amount: Num;
  /** Классификация операции подтверждена */
  classified: boolean;
  currency: string | null;
}

export interface AccountingCostResult {
  /** Сумма подтверждённо классифицированных операций по статье */
  value: Num;
  /** true — методика учёта согласована с бухгалтерией; иначе это «Импортированные затраты по 1С» */
  methodologyConfirmed: boolean;
  label: string;
  excludedForeignCurrency: number;
}

export function accountingCost(
  allocations: CostAllocationInput[],
  currency: string,
  methodologyConfirmed: boolean,
): AccountingCostResult {
  let foreign = 0;
  const values: Num[] = [];
  for (const a of allocations) {
    if (!a.classified) continue;
    if (a.currency !== null && a.currency !== currency) {
      foreign++;
      continue;
    }
    values.push(a.amount);
  }
  return {
    value: sumKnown(values).sum,
    methodologyConfirmed,
    label: methodologyConfirmed ? "Фактические затраты" : "Импортированные затраты по 1С",
    excludedForeignCurrency: foreign,
  };
}

export interface VarianceResult {
  /** Факт − плановая стоимость соответствующего (выполненного) объёма. > 0 — перерасход. */
  value: Num;
  percent: Num;
  comparable: boolean;
  warning: string | null;
}

export function costVariance(input: {
  actualCost: Num;
  earnedValue: Num;
  methodologyConfirmed: boolean;
}): VarianceResult {
  if (input.actualCost === null || input.earnedValue === null) {
    return { value: null, percent: null, comparable: false, warning: "Нет данных для сравнения" };
  }
  const value = input.actualCost.minus(input.earnedValue);
  return {
    value,
    percent: percentOf(value, input.earnedValue),
    comparable: input.methodologyConfirmed,
    warning: input.methodologyConfirmed
      ? null
      : "Методика учёта себестоимости по 1С не подтверждена — сравнение предварительное",
  };
}

// ───────────── Прогноз (5.7) ─────────────

export interface ForecastResult {
  value: Num;
  reason: string | null;
}

export function forecastAtCompletion(input: {
  actualCost: Num;
  forecastRemainingCost: Num;
  modelConfirmed: boolean;
}): ForecastResult {
  if (!input.modelConfirmed) return { value: null, reason: "Модель прогноза не подтверждена" };
  if (input.actualCost === null || input.forecastRemainingCost === null) {
    return { value: null, reason: "Недостаточно данных для прогноза" };
  }
  return { value: input.actualCost.plus(input.forecastRemainingCost), reason: null };
}
