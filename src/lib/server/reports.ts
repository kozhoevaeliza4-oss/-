import "server-only";
import type { Permission } from "@/lib/permissions";
import { prisma } from "./db";
import { loadRegistry, RegistryRowDTO } from "./registry";
import { loadContracts } from "./contracts";
import { ISSUE_TYPES } from "./services/issues";
import { compareVersions } from "./services/estimate";
import { dec, Decimal, Num, sumKnown } from "@/lib/calc/decimal";
import { effectiveActStatus } from "@/lib/calc/rules";
import { ACT_STATUS, CLASSIFICATION_STATUS, ISSUE_SEVERITY, ISSUE_STATUS, TRANSACTION_CATEGORY } from "@/lib/labels";
import { ACTION_LABELS } from "@/lib/auditLabels";

export type ReportKind = "text" | "money" | "qty" | "pct" | "date";

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportKind;
  width?: number;
}

export type ReportRow = Record<string, string | null>;

export interface ReportResult {
  title: string;
  methodology: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  notes: string[];
  currency: string;
}

export interface ReportFilters {
  object?: string;
  stage?: string;
  from?: string;
  to?: string;
  q?: string;
  contractor?: string;
  status?: string;
  asOf?: string;
}

export const REPORT_FILTER_KEYS: (keyof ReportFilters)[] = ["object", "stage", "from", "to", "q", "contractor", "status", "asOf"];

interface ReportDef {
  title: string;
  description: string;
  /** Какие фильтры имеют смысл для отчёта */
  filters: (keyof ReportFilters)[];
  /** Права, без которых отчёт раскрыл бы закрытые данные (договоры, АВР, 1С, журнал, проблемы) */
  requires: Permission[];
  build: (projectId: string, f: ReportFilters) => Promise<Omit<ReportResult, "title" | "currency">>;
}

const s = (v: Num) => (v === null ? null : v.toString());
const total = (rows: ReportRow[], key: string) => s(sumKnown(rows.map((r) => dec(r[key]))).sum);

function rowsFilter(rows: RegistryRowDTO[], f: ReportFilters) {
  const q = f.q?.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.object || r.objectId === f.object) &&
      (!f.stage || r.stageId === f.stage) &&
      (!f.contractor || r.contractors.includes(f.contractor)) &&
      (!q || `${r.code ?? ""} ${r.name}`.toLowerCase().includes(q)) &&
      (!f.from || (r.plannedEndDate !== null && r.plannedEndDate >= f.from)) &&
      (!f.to || (r.plannedEndDate !== null && r.plannedEndDate <= f.to)),
  );
}

const ITEM_COLS: ReportColumn[] = [
  { key: "code", label: "Код", kind: "text", width: 12 },
  { key: "name", label: "Наименование работы", kind: "text", width: 40 },
  { key: "object", label: "Корпус", kind: "text", width: 12 },
  { key: "stage", label: "Этап", kind: "text", width: 14 },
];
const itemBase = (r: RegistryRowDTO): ReportRow => ({ code: r.code, name: r.name, object: r.objectName, stage: r.stageName });

const METH_FACT = (confirmed: boolean) =>
  confirmed ? "Фактические затраты — подтверждённые операции 1С категорий «Затраты/Корректировка/Сторно», распределённые на статью." : "Методика учёта 1С не согласована: показаны импортированные затраты по 1С (подтверждённые операции категорий «Затраты/Корректировка/Сторно», распределённые на статью); отклонения предварительные.";

export const REPORTS: Record<string, ReportDef> = {
  coverage: {
    requires: ["contract.view"],
    title: "Договорное покрытие сметы",
    description: "Статьи действующей сметы и их покрытие подтверждёнными договорами",
    filters: ["object", "stage", "q", "contractor", "status", "asOf"],
    async build(projectId, f) {
      const reg = await loadRegistry(projectId, { asOf: f.asOf });
      const rows = rowsFilter(reg.rows.filter((r) => r.active), f).filter((r) => !f.status || (f.status === "covered" ? r.covered : !r.covered));
      const out = rows.map((r) => ({ ...itemBase(r), plannedCost: r.plannedCost, coverage: r.coverageLabel, contractors: r.contractors.join("; ") || null, contracts: r.contracts.map((c) => c.number).filter(Boolean).join("; ") || null, contractAmount: r.contractAmount, diff: r.contractVsPlan }));
      const totalPlan = sumKnown(rows.map((r) => dec(r.plannedCost))).sum;
      const covered = sumKnown(rows.filter((r) => r.covered).map((r) => dec(r.plannedCost))).sum ?? new Decimal(0);
      const contracts = await loadContracts(projectId);
      return {
        methodology: "Покрытие = плановая стоимость статей с подтверждённым распределением на договор «действует»/«завершён» / плановая стоимость действующих статей. Суммы договоров на покрытие не делятся.",
        columns: [...ITEM_COLS, { key: "plannedCost", label: "Плановая стоимость", kind: "money" }, { key: "coverage", label: "Статус покрытия", kind: "text", width: 22 }, { key: "contractors", label: "Подрядчик", kind: "text", width: 20 }, { key: "contracts", label: "Договоры", kind: "text", width: 14 }, { key: "contractAmount", label: "Сумма по договорам", kind: "money" }, { key: "diff", label: "Договор − план", kind: "money" }],
        rows: out,
        totals: { name: "Итого", plannedCost: s(totalPlan), contractAmount: total(out, "contractAmount") },
        notes: [
          `Покрыто: ${covered.toFixed(2)} из ${totalPlan?.toFixed(2) ?? "—"} (${totalPlan && !totalPlan.isZero() ? covered.div(totalPlan).times(100).toFixed(1) : "—"} %); без договора: ${totalPlan ? totalPlan.minus(covered).toFixed(2) : "—"}`,
          `Договоры без статей: ${contracts.filter((c) => c.flags.includes("NO_ITEMS")).map((c) => `№ ${c.number}`).join(", ") || "нет"}`,
          `Договоры с нераспределённой суммой: ${contracts.filter((c) => c.flags.includes("UNALLOCATED")).map((c) => `№ ${c.number} (${c.unallocated})`).join(", ") || "нет"}`,
          `Договоры с истёкшим сроком: ${contracts.filter((c) => c.flags.includes("EXPIRED")).map((c) => `№ ${c.number}`).join(", ") || "нет"}`,
          `Статьи с несколькими договорами: ${rows.filter((r) => r.contracts.length > 1).length}`,
        ],
      };
    },
  },
  "estimate-compare": {
    requires: [],
    title: "Первоначальная и текущая смета",
    description: "Сравнение первоначальной (базовой) и действующей версий сметы",
    filters: ["q"],
    async build(projectId, f) {
      const [base, cur] = await Promise.all([prisma.estimateVersion.findFirst({ where: { projectId, isBaseline: true } }), prisma.estimateVersion.findFirst({ where: { projectId, status: "ACTIVE" } })]);
      if (!base || !cur) return { methodology: "", columns: [], rows: [], totals: null, notes: ["Нет утверждённых версий сметы"] };
      const d = await compareVersions(base.id, cur.id);
      const KIND: Record<string, string> = { added: "Добавлена", removed: "Исключена", changed: "Изменена", unchanged: "Без изменений" };
      const q = f.q?.toLowerCase();
      const rows = d.rows.filter((r) => !q || `${r.code ?? ""} ${r.name}`.toLowerCase().includes(q)).map((r) => ({ kind: KIND[r.kind], code: r.code, name: r.name, unit: r.unit, qtyBefore: r.before?.quantity ?? null, qtyAfter: r.after?.quantity ?? null, priceBefore: r.before?.unitPrice ?? null, priceAfter: r.after?.unitPrice ?? null, costBefore: r.before?.plannedCost ?? null, costAfter: r.after?.plannedCost ?? null, delta: r.costDelta }));
      return {
        methodology: `Сравнение v${base.versionNumber} «${base.name}» (первоначальная) и v${cur.versionNumber} «${cur.name}» (действующая) по ключу статьи.`,
        columns: [{ key: "kind", label: "Изменение", kind: "text", width: 14 }, { key: "code", label: "Код", kind: "text" }, { key: "name", label: "Наименование", kind: "text", width: 40 }, { key: "unit", label: "Ед.", kind: "text", width: 6 }, { key: "qtyBefore", label: "Объём было", kind: "qty" }, { key: "qtyAfter", label: "Объём стало", kind: "qty" }, { key: "priceBefore", label: "Цена было", kind: "money" }, { key: "priceAfter", label: "Цена стало", kind: "money" }, { key: "costBefore", label: "Стоимость было", kind: "money" }, { key: "costAfter", label: "Стоимость стало", kind: "money" }, { key: "delta", label: "Δ", kind: "money" }],
        rows,
        totals: { name: "Итого", costBefore: d.totalBefore, costAfter: d.totalAfter, delta: d.totalDelta },
        notes: [`Добавлено ${d.added}, исключено ${d.removed}, изменено ${d.changed}, без изменений ${d.unchanged}`],
      };
    },
  },
  "plan-fact": {
    requires: ["accounting.view"],
    title: "План-факт затрат",
    description: "Плановая стоимость выполненного и затраты по данным 1С",
    filters: ["object", "stage", "q", "contractor", "asOf"],
    async build(projectId, f) {
      const reg = await loadRegistry(projectId, { asOf: f.asOf });
      const rows = rowsFilter(reg.rows, f).filter((r) => r.active || r.accountingCost);
      const out = rows.map((r) => ({ ...itemBase(r), plannedCost: r.plannedCost, earned: r.earnedValue, cost: r.accountingCost, variance: r.variance, variancePct: r.variancePercent, comparable: r.variance === null ? null : r.varianceComparable ? "да" : "предварительно" }));
      return {
        methodology: `Отклонение = затраты по 1С − плановая стоимость выполненного объёма. ${METH_FACT(reg.project.costMethodologyConfirmed)}`,
        columns: [...ITEM_COLS, { key: "plannedCost", label: "Плановая стоимость", kind: "money" }, { key: "earned", label: "План выполненного", kind: "money" }, { key: "cost", label: reg.project.costMethodologyConfirmed ? "Фактические затраты" : "Импортированные затраты 1С", kind: "money" }, { key: "variance", label: "Отклонение", kind: "money" }, { key: "variancePct", label: "Отклонение, %", kind: "pct" }, { key: "comparable", label: "Сопоставимость", kind: "text", width: 14 }],
        rows: out,
        totals: { name: "Итого", plannedCost: total(out, "plannedCost"), earned: total(out, "earned"), cost: total(out, "cost"), variance: total(out, "variance") },
        notes: [],
      };
    },
  },
  progress: {
    requires: [],
    title: "Физическая готовность",
    description: "Плановый и фактический объём, процент выполнения",
    filters: ["object", "stage", "q", "from", "to", "asOf"],
    async build(projectId, f) {
      const reg = await loadRegistry(projectId, { asOf: f.asOf });
      const rows = rowsFilter(reg.rows.filter((r) => r.active), f);
      const out = rows.map((r) => ({ ...itemBase(r), unit: r.unit, plannedQty: r.plannedQuantity, actualQty: r.actualQuantity, percent: r.percentDisplay, percentRaw: r.percentRaw, overrun: r.overrunQuantity, overrunConfirmed: r.overrunQuantity ? (r.overrunConfirmed ? "подтверждено" : "не подтверждено") : null, asOfDate: r.progressAsOf, earned: r.earnedValue }));
      const plan = sumKnown(rows.map((r) => dec(r.plannedCost))).sum;
      const earned = sumKnown(rows.map((r) => dec(r.earnedValue))).sum;
      return {
        methodology: "Готовность = подтверждённый объём / плановый объём действующей сметы (для «процентных» работ — введённый процент). Превышение показывается отдельно; выше 100 % — только при подтверждении.",
        columns: [...ITEM_COLS, { key: "unit", label: "Ед.", kind: "text", width: 6 }, { key: "plannedQty", label: "План", kind: "qty" }, { key: "actualQty", label: "Факт", kind: "qty" }, { key: "percent", label: "Готовность, %", kind: "pct" }, { key: "percentRaw", label: "Факт, % без ограничения", kind: "pct" }, { key: "overrun", label: "Превышение", kind: "qty" }, { key: "overrunConfirmed", label: "Превышение подтв.", kind: "text" }, { key: "asOfDate", label: "На дату", kind: "date" }, { key: "earned", label: "Стоимость выполненного", kind: "money" }],
        rows: out,
        totals: { name: "Итого", earned: s(earned) },
        notes: [`Средневзвешенная готовность (по плановой стоимости): ${plan && earned && !plan.isZero() ? earned.div(plan).times(100).toFixed(1) + " %" : "нет данных"}; статей без данных о выполнении: ${rows.filter((r) => r.percentRaw === null).length}`],
      };
    },
  },
  "no-contract": {
    requires: ["contract.view"],
    title: "Работы без договора",
    description: "Действующие статьи без подтверждённого действующего договора",
    filters: ["object", "stage", "q", "asOf"],
    async build(projectId, f) {
      const reg = await loadRegistry(projectId, { asOf: f.asOf });
      const rows = rowsFilter(reg.rows.filter((r) => r.active && !r.covered), f);
      const out = rows.map((r) => ({ ...itemBase(r), plannedCost: r.plannedCost, coverage: r.coverageLabel, percent: r.percentDisplay, earned: r.earnedValue }));
      return {
        methodology: "Статья без договора — нет подтверждённого распределения на договор в статусе «действует»/«завершён».",
        columns: [...ITEM_COLS, { key: "plannedCost", label: "Плановая стоимость", kind: "money" }, { key: "coverage", label: "Статус", kind: "text", width: 24 }, { key: "percent", label: "Готовность, %", kind: "pct" }, { key: "earned", label: "Выполнено (расчётно)", kind: "money" }],
        rows: out,
        totals: { name: "Итого", plannedCost: total(out, "plannedCost"), earned: total(out, "earned") },
        notes: [`Из них выполняются без договора: ${rows.filter((r) => r.percentRaw !== null && Number(r.percentRaw) > 0).length}`],
      };
    },
  },
  unfinished: {
    requires: [],
    title: "Невыполненные работы",
    description: "Остатки объёмов и плановой стоимости, сроки",
    filters: ["object", "stage", "q", "from", "to", "asOf"],
    async build(projectId, f) {
      const reg = await loadRegistry(projectId, { asOf: f.asOf });
      const rows = rowsFilter(reg.rows.filter((r) => r.active && !(r.percentRaw !== null && Number(r.percentRaw) >= 100)), f);
      const out = rows.map((r) => ({ ...itemBase(r), unit: r.unit, remainingQty: r.remainingQuantity ?? r.plannedQuantity, remainingCost: r.remainingCost ?? r.plannedCost, percent: r.percentDisplay, plannedEnd: r.plannedEndDate, overdue: r.overdue ? "просрочено" : null }));
      return {
        methodology: "Остаток объёма = план − факт; остаток стоимости = плановая стоимость − расчётная стоимость выполненного. Если выполнение не вносилось, остаток равен плану.",
        columns: [...ITEM_COLS, { key: "unit", label: "Ед.", kind: "text", width: 6 }, { key: "remainingQty", label: "Остаток объёма", kind: "qty" }, { key: "remainingCost", label: "Остаток стоимости", kind: "money" }, { key: "percent", label: "Готовность, %", kind: "pct" }, { key: "plannedEnd", label: "План. завершение", kind: "date" }, { key: "overdue", label: "Срок", kind: "text" }],
        rows: out,
        totals: { name: "Итого", remainingCost: total(out, "remainingCost") },
        notes: [`Просрочено: ${rows.filter((r) => r.overdue).length}`],
      };
    },
  },
  acts: {
    requires: ["act.view"],
    title: "Реестр АВР",
    description: "Акты выполненных работ со статусами и суммами",
    filters: ["from", "to", "contractor", "status", "q"],
    async build(projectId, f) {
      const acts = await prisma.act.findMany({
        where: {
          projectId,
          ...(f.status ? { status: f.status as never } : {}),
          ...(f.from || f.to ? { date: { ...(f.from ? { gte: new Date(f.from + "T00:00:00Z") } : {}), ...(f.to ? { lte: new Date(f.to + "T00:00:00Z") } : {}) } } : {}),
          ...(f.q ? { number: { contains: f.q, mode: "insensitive" } } : {}),
        },
        include: { contract: true, contractor: true, lines: { include: { allocations: { select: { id: true } } } } },
        orderBy: { date: "asc" },
      });
      const rows = acts
        .filter((a) => !f.contractor || a.contractor?.name === f.contractor)
        .map((a) => ({ number: a.number, date: a.date.toISOString().slice(0, 10), period: a.periodFrom ? `${a.periodFrom.toISOString().slice(0, 10)} – ${a.periodTo?.toISOString().slice(0, 10) ?? ""}` : null, contract: a.contract?.number ?? "без договора", contractor: a.contractor?.name ?? a.contractorName, status: ACT_STATUS[a.status].label, correction: a.isCorrection ? "да" : null, total: s(sumKnown(a.lines.map((l) => dec(l.amount))).sum), accepted: effectiveActStatus(a) === "SIGNED" ? s(sumKnown(a.lines.map((l) => dec(l.amount))).sum) : null, unmatched: String(a.lines.filter((l) => !l.allocations.length).length), override: a.limitOverride ? a.limitOverrideComment : null }));
      return {
        methodology: "Принято по АВР — только подписанные действующие акты; скорректированные (заменённые) и аннулированные исключаются, корректировочный акт учитывается вместо исходного.",
        columns: [{ key: "number", label: "№", kind: "text" }, { key: "date", label: "Дата", kind: "date" }, { key: "period", label: "Период", kind: "text", width: 22 }, { key: "contract", label: "Договор", kind: "text" }, { key: "contractor", label: "Подрядчик", kind: "text", width: 22 }, { key: "status", label: "Статус", kind: "text", width: 16 }, { key: "correction", label: "Корректировка", kind: "text" }, { key: "total", label: "Сумма строк", kind: "money" }, { key: "accepted", label: "Принято", kind: "money" }, { key: "unmatched", label: "Строк без статьи", kind: "text" }, { key: "override", label: "Исключение по лимитам", kind: "text", width: 24 }],
        rows,
        totals: { number: "Итого", total: total(rows, "total"), accepted: total(rows, "accepted") },
        notes: [],
      };
    },
  },
  reconciliation: {
    requires: ["act.view"],
    title: "Сверка физической готовности и АВР",
    description: "Расчётная стоимость выполненного и принятое по подписанным АВР",
    filters: ["object", "stage", "q", "contractor", "asOf"],
    async build(projectId, f) {
      const reg = await loadRegistry(projectId, { asOf: f.asOf });
      const rows = rowsFilter(reg.rows, f).filter((r) => r.earnedValue || r.actsAccepted);
      const out = rows.map((r) => ({ ...itemBase(r), percent: r.percentDisplay, earned: r.earnedValue, accepted: r.actsAccepted, diff: r.earnedVsActs, documented: r.documentedPercent, pending: r.actsPending }));
      return {
        methodology: "Расхождение = расчётная стоимость физически выполненного − принято по подписанным АВР. Это индикатор для сверки, а не задолженность или убыток.",
        columns: [...ITEM_COLS, { key: "percent", label: "Готовность, %", kind: "pct" }, { key: "earned", label: "Выполнено (расчётно)", kind: "money" }, { key: "accepted", label: "Принято по АВР", kind: "money" }, { key: "diff", label: "Расхождение", kind: "money" }, { key: "documented", label: "Документально, %", kind: "pct" }, { key: "pending", label: "АВР на согласовании", kind: "money" }],
        rows: out,
        totals: { name: "Итого", earned: total(out, "earned"), accepted: total(out, "accepted"), diff: total(out, "diff"), pending: total(out, "pending") },
        notes: [],
      };
    },
  },
  contractors: {
    requires: ["contract.view", "act.view", "accounting.view"],
    title: "Затраты по подрядчикам",
    description: "Договоры, распределение, АВР, оплаты и затраты 1С по каждому подрядчику",
    filters: ["contractor"],
    async build(projectId, f) {
      const [contracts, costs] = await Promise.all([
        loadContracts(projectId),
        prisma.transactionAllocation.findMany({ where: { transaction: { projectId, classification: "CONFIRMED", category: { in: ["COST", "ADJUSTMENT", "REVERSAL"] } } }, include: { contract: { select: { contractorId: true } } } }),
      ]);
      const by = new Map<string, { name: string; contracts: number; amount: Num[]; allocated: Num[]; acts: Num[]; paid: Num[]; cost: Num[] }>();
      for (const c of contracts) {
        const k = c.contractorId ?? "none";
        const e = by.get(k) ?? { name: c.contractor ?? "Подрядчик не указан", contracts: 0, amount: [], allocated: [], acts: [], paid: [], cost: [] };
        e.contracts++;
        if (c.status === "ACTIVE" || c.status === "COMPLETED") e.amount.push(dec(c.currentAmount));
        e.allocated.push(dec(c.allocatedConfirmed));
        e.acts.push(dec(c.actsAccepted));
        e.paid.push(dec(c.paid));
        by.set(k, e);
      }
      for (const a of costs) {
        const k = a.contractorId ?? a.contract?.contractorId;
        if (!k || !by.has(k)) continue;
        by.get(k)!.cost.push(dec(a.amount));
      }
      const rows = [...by.values()].filter((e) => !f.contractor || e.name === f.contractor).map((e) => ({ contractor: e.name, contracts: String(e.contracts), amount: s(sumKnown(e.amount).sum), allocated: s(sumKnown(e.allocated).sum), acts: s(sumKnown(e.acts).sum), paid: s(sumKnown(e.paid).sum), cost: s(sumKnown(e.cost).sum) }));
      return {
        methodology: "Сумма договоров — действующие и завершённые договоры с подписанными доп. соглашениями. Затраты 1С — подтверждённые операции, отнесённые к договору/подрядчику подрядчика.",
        columns: [{ key: "contractor", label: "Подрядчик", kind: "text", width: 30 }, { key: "contracts", label: "Договоров", kind: "text" }, { key: "amount", label: "Сумма договоров", kind: "money" }, { key: "allocated", label: "Распределено на статьи", kind: "money" }, { key: "acts", label: "Принято по АВР", kind: "money" }, { key: "paid", label: "Оплачено", kind: "money" }, { key: "cost", label: "Затраты 1С", kind: "money" }],
        rows,
        totals: { contractor: "Итого", amount: total(rows, "amount"), allocated: total(rows, "allocated"), acts: total(rows, "acts"), paid: total(rows, "paid"), cost: total(rows, "cost") },
        notes: [],
      };
    },
  },
  structure: {
    requires: ["act.view", "accounting.view"],
    title: "Затраты по корпусам и этапам",
    description: "Свод по корпусам и этапам: план, выполнение, АВР, затраты",
    filters: ["object", "stage", "asOf"],
    async build(projectId, f) {
      const reg = await loadRegistry(projectId, { asOf: f.asOf });
      const rows = rowsFilter(reg.rows, f);
      const groups = new Map<string, RegistryRowDTO[]>();
      for (const r of rows) {
        const k = `${r.objectName ?? "Без корпуса"}|${r.stageName ?? "Без этапа"}`;
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      const out = [...groups].sort(([a], [b]) => a.localeCompare(b, "ru")).map(([k, rs]) => {
        const [object, stage] = k.split("|");
        const plan = sumKnown(rs.filter((r) => r.active).map((r) => dec(r.plannedCost))).sum;
        const earned = sumKnown(rs.map((r) => dec(r.earnedValue))).sum;
        return { object, stage, items: String(rs.length), plannedCost: s(plan), earned: s(earned), percent: plan && earned && !plan.isZero() ? earned.div(plan).times(100).toFixed(2) : null, acts: s(sumKnown(rs.map((r) => dec(r.actsAccepted))).sum), cost: s(sumKnown(rs.map((r) => dec(r.accountingCost))).sum) };
      });
      return {
        methodology: `Готовность группы = расчётная стоимость выполненного / плановая стоимость. ${METH_FACT(reg.project.costMethodologyConfirmed)}`,
        columns: [{ key: "object", label: "Корпус", kind: "text", width: 18 }, { key: "stage", label: "Этап", kind: "text", width: 18 }, { key: "items", label: "Статей", kind: "text" }, { key: "plannedCost", label: "Плановая стоимость", kind: "money" }, { key: "earned", label: "Выполнено (расчётно)", kind: "money" }, { key: "percent", label: "Готовность, %", kind: "pct" }, { key: "acts", label: "Принято по АВР", kind: "money" }, { key: "cost", label: "Затраты 1С", kind: "money" }],
        rows: out,
        totals: { object: "Итого", plannedCost: total(out, "plannedCost"), earned: total(out, "earned"), acts: total(out, "acts"), cost: total(out, "cost") },
        notes: [],
      };
    },
  },
  "unclassified-1c": {
    requires: ["accounting.view"],
    title: "Операции 1С без классификации",
    description: "Операции, требующие классификации или подтверждения",
    filters: ["from", "to", "q", "status"],
    async build(projectId, f) {
      const txs = await prisma.accountingTransaction.findMany({
        where: {
          projectId,
          classification: f.status ? (f.status as never) : { in: ["UNCLASSIFIED", "PROPOSED"] },
          ...(f.from || f.to ? { date: { ...(f.from ? { gte: new Date(f.from + "T00:00:00Z") } : {}), ...(f.to ? { lte: new Date(f.to + "T00:00:00Z") } : {}) } } : {}),
          ...(f.q ? { OR: [{ documentNumber: { contains: f.q, mode: "insensitive" } }, { counterparty: { contains: f.q, mode: "insensitive" } }, { comment: { contains: f.q, mode: "insensitive" } }] } : {}),
        },
        orderBy: { date: "asc" },
        take: 5000,
      });
      const rows = txs.map((t) => ({ date: t.date?.toISOString().slice(0, 10) ?? null, doc: t.documentNumber, dt: t.account, kt: t.corrAccount, amount: t.amount?.toString() ?? null, counterparty: t.counterparty, analytics: [t.objectText, t.costItemText, t.contractText, t.comment].filter(Boolean).join(" · ") || null, status: CLASSIFICATION_STATUS[t.classification].label, category: TRANSACTION_CATEGORY[t.category] }));
      return {
        methodology: "Неклассифицированные и предложенные правилом операции не входят в себестоимость статей до подтверждения.",
        columns: [{ key: "date", label: "Дата", kind: "date" }, { key: "doc", label: "Документ", kind: "text", width: 18 }, { key: "dt", label: "Дт", kind: "text" }, { key: "kt", label: "Кт", kind: "text" }, { key: "amount", label: "Сумма", kind: "money" }, { key: "counterparty", label: "Контрагент", kind: "text", width: 20 }, { key: "analytics", label: "Аналитика", kind: "text", width: 36 }, { key: "status", label: "Статус", kind: "text", width: 18 }, { key: "category", label: "Категория", kind: "text", width: 16 }],
        rows,
        totals: { date: "Итого", amount: total(rows, "amount") },
        notes: txs.length === 5000 ? ["Показаны первые 5000 операций"] : [],
      };
    },
  },
  forecast: {
    requires: ["accounting.view"],
    title: "Прогноз стоимости завершения",
    description: "Первоначальная, текущая утверждённая стоимость и прогноз",
    filters: ["object", "stage", "q", "asOf"],
    async build(projectId, f) {
      const reg = await loadRegistry(projectId, { asOf: f.asOf });
      const rows = rowsFilter(reg.rows, f);
      const out = rows.map((r) => ({ ...itemBase(r), baseline: r.baselinePlannedCost, current: r.plannedCost, cost: r.accountingCost, forecast: r.forecast, reason: r.forecastReason, vsCurrent: r.forecast && r.plannedCost ? (Number(r.forecast) - Number(r.plannedCost)).toFixed(2) : null }));
      return {
        methodology: reg.project.forecastModelConfirmed ? "Прогноз = фактические затраты + прогноз затрат на остаток (ручной ввод по статье). Прогноз не является утверждённым бюджетом." : "Модель прогноза не подтверждена — прогноз не рассчитывается.",
        columns: [...ITEM_COLS, { key: "baseline", label: "Первоначальная", kind: "money" }, { key: "current", label: "Текущая утверждённая", kind: "money" }, { key: "cost", label: "Затраты 1С", kind: "money" }, { key: "forecast", label: "Прогноз", kind: "money" }, { key: "vsCurrent", label: "Прогноз − текущая", kind: "money" }, { key: "reason", label: "Примечание", kind: "text", width: 26 }],
        rows: out,
        totals: { name: "Итого", baseline: total(out, "baseline"), current: total(out, "current"), cost: total(out, "cost"), forecast: total(out, "forecast") },
        notes: [`Статей без прогноза: ${rows.filter((r) => r.forecast === null).length} — итог прогноза неполный, если это число больше нуля`],
      };
    },
  },
  audit: {
    requires: ["audit.view"],
    title: "Журнал изменений",
    description: "Действия пользователей за период",
    filters: ["from", "to", "q"],
    async build(projectId, f) {
      const logs = await prisma.auditLog.findMany({
        where: { projectId, ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: new Date(f.from + "T00:00:00Z") } : {}), ...(f.to ? { lte: new Date(f.to + "T23:59:59Z") } : {}) } } : {}), ...(f.q ? { action: { contains: f.q } } : {}) },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
        take: 5000,
      });
      const rows = logs.map((l) => ({ at: l.createdAt.toISOString().replace("T", " ").slice(0, 19), user: l.user?.name ?? "система", action: ACTION_LABELS[l.action] ?? l.action, entity: `${l.entityType}${l.entityId ? ` ${l.entityId.slice(-8)}` : ""}`, comment: l.comment, after: l.after ? JSON.stringify(l.after).slice(0, 300) : null }));
      return {
        methodology: "Записи журнала не изменяются и не удаляются.",
        columns: [{ key: "at", label: "Дата и время (UTC)", kind: "text", width: 20 }, { key: "user", label: "Пользователь", kind: "text", width: 18 }, { key: "action", label: "Действие", kind: "text", width: 26 }, { key: "entity", label: "Объект", kind: "text", width: 20 }, { key: "comment", label: "Комментарий", kind: "text", width: 26 }, { key: "after", label: "Данные", kind: "text", width: 40 }],
        rows,
        totals: null,
        notes: logs.length === 5000 ? ["Показаны первые 5000 записей — сузьте период"] : [],
      };
    },
  },
  critical: {
    requires: ["issue.view"],
    title: "Реестр критических отклонений",
    description: "Открытые проблемы высокой и критической важности",
    filters: ["status", "q"],
    async build(projectId, f) {
      const issues = await prisma.issue.findMany({
        where: { projectId, severity: { in: ["HIGH", "CRITICAL"] }, status: f.status ? (f.status as never) : { in: ["NEW", "ASSIGNED", "IN_REVIEW", "NEEDS_DECISION"] }, ...(f.q ? { title: { contains: f.q, mode: "insensitive" } } : {}) },
        include: { assignee: { select: { name: true } } },
        orderBy: [{ severity: "desc" }, { detectedAt: "asc" }],
      });
      const rows = issues.map((i) => ({ type: ISSUE_TYPES[i.type] ?? i.type, title: i.title, severity: ISSUE_SEVERITY[i.severity].label, amount: i.amount?.toString() ?? null, source: i.source, detected: i.detectedAt.toISOString().slice(0, 10), assignee: i.assignee?.name ?? null, status: ISSUE_STATUS[i.status].label, comment: i.comment }));
      return {
        methodology: "Проблемы создаются проверками автоматически и закрываются только устранением причины или исключением с обоснованием.",
        columns: [{ key: "type", label: "Тип", kind: "text", width: 26 }, { key: "title", label: "Объект", kind: "text", width: 34 }, { key: "severity", label: "Важность", kind: "text" }, { key: "amount", label: "Сумма", kind: "money" }, { key: "source", label: "Источник", kind: "text", width: 18 }, { key: "detected", label: "Обнаружено", kind: "date" }, { key: "assignee", label: "Ответственный", kind: "text", width: 16 }, { key: "status", label: "Статус", kind: "text", width: 16 }, { key: "comment", label: "Комментарий", kind: "text", width: 24 }],
        rows,
        totals: { type: "Итого", amount: total(rows, "amount") },
        notes: [],
      };
    },
  },
};

/** Доступен ли отчёт роли: все требуемые права должны быть у пользователя. */
export function reportAllowed(kind: string, can: (p: Permission) => boolean): boolean {
  const def = REPORTS[kind];
  return !!def && def.requires.every(can);
}

export async function buildReport(projectId: string, kind: string, f: ReportFilters): Promise<ReportResult | null> {
  const def = REPORTS[kind];
  if (!def) return null;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const r = await def.build(projectId, f);
  return { ...r, title: def.title, currency: project.currency };
}
