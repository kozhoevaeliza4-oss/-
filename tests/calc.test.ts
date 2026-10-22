import { describe, expect, it } from "vitest";
import { dec, Decimal } from "@/lib/calc/decimal";
import { computeProgress, plannedCost, reconcileEarnedVsActs, actsSummary, costVariance, forecastAtCompletion, accountingCost } from "@/lib/calc/workItem";
import { itemCoverage, projectCoverage, contractCurrentAmount, contractUnallocated } from "@/lib/calc/coverage";
import { computeRegistryRow, RegistryRowInput } from "@/lib/calc/registryRow";

const d = (v: string | number) => new Decimal(v);
const s = (v: Decimal | null) => (v === null ? null : v.toFixed(2));

function baseRow(over: Partial<RegistryRowInput> = {}): RegistryRowInput {
  return {
    currency: "KGS",
    today: new Date("2026-10-22"),
    measurementType: "QUANTITY",
    currentPlan: { quantity: d(100), unitPrice: d(1000), sourceTotal: null, currency: "KGS" },
    baselinePlan: null,
    progress: null,
    allocations: [],
    actLines: [],
    costAllocations: [],
    payments: [],
    plannedEndDate: null,
    actualEndDate: null,
    forecastRemainingCost: null,
    methodologyConfirmed: false,
    forecastModelConfirmed: false,
    ...over,
  };
}

describe("Тест 1. Расчёт выполнения", () => {
  it("100 м² × 1000 сом, факт 40 м²", () => {
    const r = computeRegistryRow(
      baseRow({ progress: { quantity: d(40), percent: null, overrunConfirmed: false, asOfDate: null } }),
    );
    expect(s(r.plan!.value)).toBe("100000.00");
    expect(s(r.progress.percentDisplay)).toBe("40.00");
    expect(s(r.earned.value)).toBe("40000.00");
    expect(s(r.progress.remainingQuantity)).toBe("60.00");
    expect(s(r.earned.remainingCost)).toBe("60000.00");
  });
});

describe("Тест 2. Договорное покрытие", () => {
  it("70% при покрытии 7 000 000 из 10 000 000, без дублирования договоров", () => {
    const res = projectCoverage([
      { plannedCost: d(4_000_000), covered: true, active: true },
      { plannedCost: d(3_000_000), covered: true, active: true },
      { plannedCost: d(2_000_000), covered: false, active: true },
      { plannedCost: d(1_000_000), covered: false, active: true },
    ]);
    expect(s(res.totalEstimate)).toBe("10000000.00");
    expect(s(res.coveredValue)).toBe("7000000.00");
    expect(s(res.coveragePercent)).toBe("70.00");
    expect(s(res.uncoveredValue)).toBe("3000000.00");
  });

  it("один договор на несколько статей и несколько договоров на одну статью не удваивают покрытие", () => {
    const shared = { allocationStatus: "CONFIRMED" as const, contractStatus: "ACTIVE" as const, quantity: null, currency: "KGS" };
    const item = itemCoverage({
      allocations: [
        { ...shared, contractId: "A", amount: d(300) },
        { ...shared, contractId: "B", amount: d(800) },
      ],
      plannedCost: d(1000),
      plannedQuantity: null,
      currency: "KGS",
    });
    expect(item.covered).toBe(true);
    expect(item.coveringContracts).toBe(2);
    expect(s(item.contractVsPlan)).toBe("100.00");
    // статья входит в покрытие своей плановой стоимостью один раз
    const res = projectCoverage([{ plannedCost: d(1000), covered: item.covered, active: true }]);
    expect(s(res.coveredValue)).toBe("1000.00");
    expect(s(res.coveragePercent)).toBe("100.00");
  });

  it("неактивные статьи (исключённые из сметы) не входят в общий объём", () => {
    const res = projectCoverage([
      { plannedCost: d(100), covered: false, active: true },
      { plannedCost: d(900), covered: true, active: false },
    ]);
    expect(s(res.totalEstimate)).toBe("100.00");
    expect(s(res.coveragePercent)).toBe("0.00");
  });
});

describe("Тест 3. АВР и физическая готовность", () => {
  it("80% готовности, АВР 500 000 — разница 300 000 и предупреждение о сверке", () => {
    const r = computeRegistryRow(
      baseRow({
        measurementType: "PERCENT",
        currentPlan: { quantity: null, unitPrice: null, sourceTotal: d(1_000_000), currency: "KGS" },
        progress: { quantity: null, percent: d(80), overrunConfirmed: false, asOfDate: null },
        actLines: [{ amount: d(500_000), status: "SIGNED", currency: "KGS" }],
      }),
    );
    expect(s(r.progress.percentDisplay)).toBe("80.00");
    expect(s(r.earned.value)).toBe("800000.00");
    expect(s(r.acts.accepted)).toBe("500000.00");
    expect(s(r.reconciliation.difference)).toBe("300000.00");
    expect(r.reconciliation.needsReconciliation).toBe(true);
    expect(r.reconciliation.message).toMatch(/не является автоматически задолженностью/);
    expect(s(r.documentedPercent)).toBe("50.00");
    expect(r.flags.map((f) => f.code)).toContain("RECONCILE_ACTS");
  });

  it("неподписанные и отклонённые акты не входят в принятую стоимость; корректировки учитываются со знаком", () => {
    const a = actsSummary(
      [
        { amount: d(100), status: "SIGNED", currency: "KGS" },
        { amount: d(-30), status: "SIGNED", currency: "KGS" },
        { amount: d(500), status: "ON_APPROVAL", currency: "KGS" },
        { amount: d(700), status: "PREPARED", currency: "KGS" },
        { amount: d(900), status: "REJECTED", currency: "KGS" },
        { amount: d(50), status: "SIGNED", currency: "USD" },
      ],
      "KGS",
    );
    expect(s(a.accepted)).toBe("70.00");
    expect(s(a.pending)).toBe("1200.00");
    expect(a.foreignCurrencyLines).toBe(1);
  });
});

describe("Тест 5. Отсутствие договора", () => {
  it("статья без действующего договора — непокрыта и входит в работы без договора", () => {
    const r = computeRegistryRow(
      baseRow({ currentPlan: { quantity: null, unitPrice: null, sourceTotal: d(500_000), currency: "KGS" } }),
    );
    expect(r.coverage.status).toBe("NONE");
    expect(r.coverage.covered).toBe(false);
    const res = projectCoverage([{ plannedCost: r.plan!.value, covered: r.coverage.covered, active: r.active }]);
    expect(s(res.uncoveredValue)).toBe("500000.00");
    expect(s(res.coveragePercent)).toBe("0.00");
  });

  it("загруженный, но непроверенный договор не даёт покрытия", () => {
    const c = itemCoverage({
      allocations: [
        { contractId: "X", allocationStatus: "CONFIRMED", contractStatus: "UPLOADED_NEEDS_REVIEW", amount: d(1), quantity: null, currency: "KGS" },
      ],
      plannedCost: d(10),
      plannedQuantity: null,
      currency: "KGS",
    });
    expect(c.covered).toBe(false);
    expect(c.status).toBe("NEEDS_REVIEW");
  });

  it("предложенное (неподтверждённое) распределение на действующий договор не даёт покрытия", () => {
    const c = itemCoverage({
      allocations: [{ contractId: "X", allocationStatus: "PROPOSED", contractStatus: "ACTIVE", amount: d(1), quantity: null, currency: "KGS" }],
      plannedCost: d(10),
      plannedQuantity: null,
      currency: "KGS",
    });
    expect(c.covered).toBe(false);
    expect(c.status).toBe("NEEDS_REVIEW");
  });

  it("расторгнутый договор не даёт покрытия", () => {
    const c = itemCoverage({
      allocations: [{ contractId: "X", allocationStatus: "CONFIRMED", contractStatus: "TERMINATED", amount: d(1), quantity: null, currency: "KGS" }],
      plannedCost: d(10),
      plannedQuantity: null,
      currency: "KGS",
    });
    expect(c.covered).toBe(false);
    expect(c.status).toBe("TERMINATED");
  });
});

describe("Тест 6. Превышение объёма", () => {
  it("подтверждённое превышение: 110% и +10 м²", () => {
    const p = computeProgress({
      measurementType: "QUANTITY",
      plannedQuantity: d(100),
      actualQuantity: d(110),
      manualPercent: null,
      overrunConfirmed: true,
    });
    expect(s(p.percentDisplay)).toBe("110.00");
    expect(s(p.overrunQuantity)).toBe("10.00");
    expect(s(p.remainingQuantity)).toBe("-10.00");
  });

  it("неподтверждённое превышение не скрывается: исходные 110% и +10 м² сохраняются отдельно", () => {
    const r = computeRegistryRow(
      baseRow({ progress: { quantity: d(110), percent: null, overrunConfirmed: false, asOfDate: null } }),
    );
    expect(s(r.progress.percentRaw)).toBe("110.00");
    expect(s(r.progress.percentDisplay)).toBe("100.00");
    expect(s(r.progress.overrunQuantity)).toBe("10.00");
    // в стоимость выполненного неподтверждённое превышение не включается, но показывается отдельно
    expect(s(r.earned.value)).toBe("100000.00");
    expect(s(r.earned.unconfirmedOverrunValue)).toBe("10000.00");
    expect(r.level).toBe("red");
    expect(r.flags.map((f) => f.code)).toContain("OVERRUN_UNCONFIRMED");
  });
});

describe("Деление на ноль и отсутствие данных", () => {
  it("нулевой плановый объём — «нет данных», не деление на ноль", () => {
    const p = computeProgress({ measurementType: "QUANTITY", plannedQuantity: d(0), actualQuantity: d(5), manualPercent: null, overrunConfirmed: false });
    expect(p.status).toBe("NO_PLAN");
    expect(p.percentRaw).toBeNull();
  });

  it("отсутствие факта — null, а не ноль", () => {
    const r = computeRegistryRow(baseRow());
    expect(r.progress.percentDisplay).toBeNull();
    expect(r.earned.value).toBeNull();
    expect(r.acts.accepted).toBeNull();
    expect(r.cost.value).toBeNull();
  });

  it("dec: пустые строки и мусор → null", () => {
    expect(dec("")).toBeNull();
    expect(dec("abc")).toBeNull();
    expect(dec(null)).toBeNull();
    expect(dec("12.5")!.toString()).toBe("12.5");
  });
});

describe("Плановая стоимость строки сметы", () => {
  it("итог из сметы приоритетнее расчёта, расхождение фиксируется", () => {
    const r = plannedCost({ quantity: d(10), unitPrice: d(99.99), sourceTotal: d(1010) });
    expect(s(r.value)).toBe("1010.00");
    expect(r.source).toBe("SOURCE_TOTAL");
    expect(s(r.discrepancy)).toBe("10.10");
    expect(r.hasDiscrepancy).toBe(true);
  });
  it("без итога — объём × цена", () => {
    const r = plannedCost({ quantity: d("12.5"), unitPrice: d("800.40"), sourceTotal: null });
    expect(s(r.value)).toBe("10005.00");
    expect(r.source).toBe("COMPUTED");
  });
  it("точность десятичных: 0.1 + 0.2", () => {
    const r = plannedCost({ quantity: d("0.1"), unitPrice: d(3), sourceTotal: d("0.30") });
    expect(r.hasDiscrepancy).toBe(false);
  });
});

describe("Затраты, отклонение, прогноз", () => {
  it("неклассифицированные операции не входят в затраты статьи (тест 8)", () => {
    const c = accountingCost(
      [
        { amount: d(100), classified: true, currency: "KGS" },
        { amount: d(999), classified: false, currency: "KGS" },
      ],
      "KGS",
      false,
    );
    expect(s(c.value)).toBe("100.00");
    expect(c.label).toBe("Импортированные затраты по 1С");
  });
  it("отклонение = факт − плановая стоимость выполненного", () => {
    const v = costVariance({ actualCost: d(45000), earnedValue: d(40000), methodologyConfirmed: true });
    expect(s(v.value)).toBe("5000.00");
    expect(s(v.percent)).toBe("12.50");
    expect(v.comparable).toBe(true);
  });
  it("прогноз без данных по остатку не выдаёт фиктивную сумму", () => {
    expect(forecastAtCompletion({ actualCost: d(1), forecastRemainingCost: null, modelConfirmed: true }).value).toBeNull();
    expect(forecastAtCompletion({ actualCost: d(1), forecastRemainingCost: d(2), modelConfirmed: false }).value).toBeNull();
    expect(s(forecastAtCompletion({ actualCost: d(1), forecastRemainingCost: d(2), modelConfirmed: true }).value)).toBe("3.00");
  });
  it("сверка: АВР без физического выполнения", () => {
    const r = reconcileEarnedVsActs(d(100), d(150));
    expect(r.needsReconciliation).toBe(true);
    expect(s(r.difference)).toBe("-50.00");
  });
});

describe("Суммы договоров", () => {
  it("текущая сумма с доп. соглашениями и нераспределённый остаток", () => {
    const cur = contractCurrentAmount({ totalAmount: d(1000), amendmentDeltas: [d(200), d(-50)] });
    expect(s(cur.value)).toBe("1150.00");
    expect(s(contractUnallocated(cur.value, [d(600), d(500)]))).toBe("50.00");
    expect(contractUnallocated(cur.value, [d(600), null])).toBeNull();
  });
});

describe("Сроки", () => {
  it("просрочка незавершённой работы — красный статус", () => {
    const r = computeRegistryRow(
      baseRow({
        plannedEndDate: new Date("2026-09-01"),
        progress: { quantity: d(50), percent: null, overrunConfirmed: false, asOfDate: null },
      }),
    );
    expect(r.overdue).toBe(true);
    expect(r.level).toBe("red");
  });
  it("завершённая работа не просрочена", () => {
    const r = computeRegistryRow(
      baseRow({
        plannedEndDate: new Date("2026-09-01"),
        progress: { quantity: d(100), percent: null, overrunConfirmed: false, asOfDate: null },
      }),
    );
    expect(r.overdue).toBe(false);
  });
});
