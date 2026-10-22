/**
 * Договорное покрытие сметы (раздел 6 ТЗ).
 *
 * Покрытие считается по плановой стоимости статей, а НЕ делением суммы договоров на сумму сметы:
 * один договор может покрывать несколько статей, несколько договоров — одну статью.
 * Статья считается покрытой, если у неё есть подтверждённое распределение на договор
 * в статусе «действует» или «завершён». Наличие загруженного файла договора покрытием не является.
 */
import { Decimal, Num, percentOf, sub, sumKnown } from "./decimal";

export type ContractStatus = "UPLOADED_NEEDS_REVIEW" | "ACTIVE" | "COMPLETED" | "TERMINATED" | "NEEDS_CLARIFICATION";
export type AllocationStatus = "PROPOSED" | "CONFIRMED" | "REJECTED";

export type CoverageStatus =
  | "NONE" // договор отсутствует
  | "NEEDS_REVIEW" // договор загружен, требуется проверка
  | "ACTIVE" // договор подписан и действует
  | "COMPLETED" // договор завершён
  | "TERMINATED" // договор расторгнут
  | "NEEDS_CLARIFICATION"; // договор требует уточнения

export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  NONE: "Договор отсутствует",
  NEEDS_REVIEW: "Договор загружен, требуется проверка",
  ACTIVE: "Договор подписан и действует",
  COMPLETED: "Договор завершён",
  TERMINATED: "Договор расторгнут",
  NEEDS_CLARIFICATION: "Договор требует уточнения",
};

/** Статусы договора, при которых подтверждённое распределение считается покрытием. */
export const COVERING_CONTRACT_STATUSES: ContractStatus[] = ["ACTIVE", "COMPLETED"];

export interface AllocationInput {
  contractId: string;
  allocationStatus: AllocationStatus;
  contractStatus: ContractStatus;
  amount: Num;
  quantity: Num;
  currency: string | null;
}

export interface ItemCoverageResult {
  status: CoverageStatus;
  covered: boolean;
  /** Количество разных договоров, подтверждённо покрывающих статью */
  coveringContracts: number;
  /** Сумма подтверждённых распределений действующих/завершённых договоров на статью */
  contractAmount: Num;
  /** У части подтверждённых распределений не указана сумма */
  contractAmountIncomplete: boolean;
  /** Подтверждённый объём по договорам меньше планового — частичное покрытие по объёму */
  partialVolume: boolean;
  /** Сумма договоров по статье − плановая стоимость статьи */
  contractVsPlan: Num;
}

const PRIORITY: CoverageStatus[] = ["ACTIVE", "COMPLETED", "NEEDS_CLARIFICATION", "NEEDS_REVIEW", "TERMINATED", "NONE"];

export function itemCoverage(input: {
  allocations: AllocationInput[];
  plannedCost: Num;
  plannedQuantity: Num;
  currency: string;
}): ItemCoverageResult {
  const candidates = new Set<CoverageStatus>();
  const coveringIds = new Set<string>();
  const amounts: Num[] = [];
  const quantities: Num[] = [];

  for (const a of input.allocations) {
    if (a.allocationStatus === "REJECTED") continue;
    if (a.contractStatus === "TERMINATED") {
      candidates.add("TERMINATED");
      continue;
    }
    if (a.allocationStatus === "PROPOSED") {
      // Распределение не подтверждено — нужна проверка независимо от статуса договора
      candidates.add(a.contractStatus === "NEEDS_CLARIFICATION" ? "NEEDS_CLARIFICATION" : "NEEDS_REVIEW");
      continue;
    }
    // CONFIRMED
    if (COVERING_CONTRACT_STATUSES.includes(a.contractStatus)) {
      candidates.add(a.contractStatus === "ACTIVE" ? "ACTIVE" : "COMPLETED");
      coveringIds.add(a.contractId);
      if (a.currency === null || a.currency === input.currency) amounts.push(a.amount);
      quantities.push(a.quantity);
    } else {
      candidates.add(a.contractStatus === "NEEDS_CLARIFICATION" ? "NEEDS_CLARIFICATION" : "NEEDS_REVIEW");
    }
  }

  const status = PRIORITY.find((s) => candidates.has(s)) ?? "NONE";
  const covered = coveringIds.size > 0;
  const amountSum = sumKnown(amounts);
  const qtySum = sumKnown(quantities);
  const partialVolume =
    covered &&
    input.plannedQuantity !== null &&
    qtySum.missing === 0 &&
    qtySum.sum !== null &&
    qtySum.sum.lt(input.plannedQuantity);

  return {
    status,
    covered,
    coveringContracts: coveringIds.size,
    contractAmount: covered ? amountSum.sum : null,
    contractAmountIncomplete: covered && amountSum.missing > 0,
    partialVolume,
    contractVsPlan: covered && amountSum.missing === 0 ? sub(amountSum.sum, input.plannedCost) : null,
  };
}

export interface CoverageItemInput {
  plannedCost: Num;
  covered: boolean;
  /** Статья действует в текущей утверждённой смете */
  active: boolean;
}

export interface ProjectCoverageResult {
  /** Общий объём сметы = сумма плановых стоимостей действующих статей */
  totalEstimate: Num;
  /** Стоимость работ с договорным покрытием */
  coveredValue: Num;
  /** Стоимость работ без подтверждённого действующего договора */
  uncoveredValue: Num;
  coveragePercent: Num;
  itemsTotal: number;
  itemsCovered: number;
  itemsUncovered: number;
  /** Действующие статьи без плановой стоимости — не входят в базу расчёта */
  itemsWithoutPlannedCost: number;
}

export function projectCoverage(items: CoverageItemInput[]): ProjectCoverageResult {
  const active = items.filter((i) => i.active);
  const withCost = active.filter((i) => i.plannedCost !== null);
  const total = sumKnown(withCost.map((i) => i.plannedCost)).sum;
  const covered = sumKnown(withCost.filter((i) => i.covered).map((i) => i.plannedCost)).sum ?? (total === null ? null : new Decimal(0));
  const uncovered = sumKnown(withCost.filter((i) => !i.covered).map((i) => i.plannedCost)).sum ?? (total === null ? null : new Decimal(0));
  return {
    totalEstimate: total,
    coveredValue: covered,
    uncoveredValue: uncovered,
    coveragePercent: percentOf(covered, total),
    itemsTotal: active.length,
    itemsCovered: active.filter((i) => i.covered).length,
    itemsUncovered: active.filter((i) => !i.covered).length,
    itemsWithoutPlannedCost: active.length - withCost.length,
  };
}

export interface ContractTotalInput {
  totalAmount: Num;
  /** Изменения суммы по подписанным доп. соглашениям */
  amendmentDeltas: Num[];
}

/** Текущая сумма договора = исходная сумма + подписанные доп. соглашения. */
export function contractCurrentAmount(c: ContractTotalInput): { value: Num; incomplete: boolean } {
  if (c.totalAmount === null) return { value: null, incomplete: true };
  const d = sumKnown(c.amendmentDeltas);
  return { value: d.sum === null ? c.totalAmount : c.totalAmount.plus(d.sum), incomplete: d.missing > 0 };
}

/** Нераспределённая сумма договора = текущая сумма − сумма подтверждённых распределений по статьям. */
export function contractUnallocated(current: Num, allocatedAmounts: Num[]): Num {
  if (current === null) return null;
  const s = sumKnown(allocatedAmounts);
  if (s.missing > 0) return null;
  return current.minus(s.sum ?? new Decimal(0));
}
