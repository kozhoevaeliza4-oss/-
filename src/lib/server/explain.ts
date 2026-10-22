import "server-only";
import type { Permission } from "@/lib/permissions";
import { prisma } from "./db";
import { loadRegistry } from "./registry";
import { loadContracts } from "./contracts";
import { dec, Decimal, Num, sumKnown } from "@/lib/calc/decimal";
import { plannedCost } from "@/lib/calc/workItem";
import { effectiveActStatus, isCostTransaction } from "@/lib/calc/rules";

/**
 * Расшифровка показателей до первичных записей. Для каждого показателя возвращается список записей
 * (строка сметы, запись выполнения, строка АВР, операция 1С, договор, платёж) и проверка,
 * что сумма записей равна показателю, выводимому в интерфейсе.
 */
export const EXPLAIN_METRICS = {
  plannedCost: "Плановая стоимость (действующая смета)",
  baselineCost: "Первоначальная смета",
  earned: "Расчётная стоимость физически выполненного",
  actsSigned: "Подписанные АВР (все строки)",
  actsAccepted: "Принято по АВР (распределено на статьи)",
  accountingCost: "Затраты по данным 1С (распределены на статьи)",
  contractsTotal: "Сумма действующих договоров",
  paid: "Оплачено",
  uncovered: "Стоимость работ без договора",
} as const;

export type ExplainMetric = keyof typeof EXPLAIN_METRICS;

/** Права, необходимые для расшифровки (раскрывает первичные записи договоров, АВР, 1С). */
export const EXPLAIN_REQUIRES: Partial<Record<ExplainMetric, Permission>> = {
  actsSigned: "act.view",
  actsAccepted: "act.view",
  accountingCost: "accounting.view",
  paid: "accounting.view",
  contractsTotal: "contract.view",
  uncovered: "contract.view",
};

export interface ExplainRecord {
  label: string;
  source: string;
  date: string | null;
  amount: string | null;
  href: string | null;
}

export interface Explanation {
  metric: ExplainMetric;
  title: string;
  methodology: string;
  /** Значение показателя, как оно выводится в интерфейсе */
  total: string | null;
  records: ExplainRecord[];
  /** Сумма записей */
  recordsTotal: string | null;
  matches: boolean;
  currency: string;
}

const s = (v: Num) => (v === null ? null : v.toFixed(2));

export async function explainMetric(projectId: string, metric: ExplainMetric, opts: { workItemId?: string; asOf?: string } = {}): Promise<Explanation> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const p = `/projects/${projectId}`;
  const cur = project.currency;
  const only = opts.workItemId;
  const reg = await loadRegistry(projectId, { workItemId: only, asOf: opts.asOf });
  const rows = reg.rows;
  let total: Num = null;
  let records: ExplainRecord[] = [];
  let methodology = "";

  switch (metric) {
    case "plannedCost":
    case "baselineCost": {
      const versionId = metric === "plannedCost" ? reg.currentVersion?.id : reg.baselineVersion?.id;
      const lines = versionId ? await prisma.estimateLine.findMany({ where: { versionId, ...(only ? { workItemId: only } : { workItemId: { not: null } }) }, include: { version: true }, orderBy: { sourceRow: "asc" } }) : [];
      records = lines.filter((l) => l.currency === cur).map((l) => ({
        label: `${l.code ? l.code + " " : ""}${l.name}`,
        source: `Смета v${l.version.versionNumber}${l.sourceRow ? `, ${l.sourceSheet}: стр. ${l.sourceRow}` : ""}`,
        date: l.version.approvedAt?.toISOString().slice(0, 10) ?? null,
        amount: s(plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) }).value),
        href: l.workItemId ? `${p}/items/${l.workItemId}` : null,
      }));
      total = metric === "plannedCost" ? sumKnown(rows.filter((r) => r.active).map((r) => dec(r.plannedCost))).sum : sumKnown(rows.map((r) => dec(r.baselinePlannedCost))).sum;
      methodology = "Итог из строки сметы, а при его отсутствии — объём × цена. В валюте проекта.";
      break;
    }
    case "earned": {
      records = rows
        .filter((r) => r.earnedValue !== null)
        .map((r) => ({
          label: `${r.code ? r.code + " " : ""}${r.name}`,
          source: r.measurementType === "PERCENT" ? `Готовность ${r.percentDisplay} % × плановая стоимость` : `Факт ${r.actualQuantity} ${r.unit ?? ""} × цена ${r.unitPrice ?? "(производная)"}${r.unconfirmedOverrunValue ? "; неподтверждённое превышение не включено" : ""}`,
          date: r.progressAsOf,
          amount: r.earnedValue,
          href: `${p}/items/${r.id}`,
        }));
      total = sumKnown(rows.map((r) => dec(r.earnedValue))).sum;
      methodology = "По последней записи выполнения на дату и утверждённым расценкам действующей сметы.";
      break;
    }
    case "actsSigned": {
      const acts = await prisma.act.findMany({ where: { projectId, currency: cur }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
      const asOf = opts.asOf ? new Date(opts.asOf + "T23:59:59.999Z") : null;
      for (const a of acts) {
        if (effectiveActStatus(a, asOf) !== "SIGNED") continue;
        for (const l of a.lines) records.push({ label: `АВР № ${a.number}: ${l.description ?? ""}`, source: `подписан ${a.signedAt?.toISOString().slice(0, 10) ?? ""}${a.isCorrection ? " (корректировочный)" : ""}`, date: a.date.toISOString().slice(0, 10), amount: l.amount.toFixed(2), href: `${p}/acts/${a.id}` });
      }
      total = sumKnown(records.map((r) => dec(r.amount))).sum;
      methodology = "Строки подписанных действующих актов; скорректированные и аннулированные исключены.";
      break;
    }
    case "actsAccepted": {
      const allocs = await prisma.actLineAllocation.findMany({
        where: { ...(only ? { workItemId: only } : {}), actLine: { act: { projectId, currency: cur } } },
        include: { workItem: true, actLine: { include: { act: true } } },
      });
      const asOf = opts.asOf ? new Date(opts.asOf + "T23:59:59.999Z") : null;
      records = allocs
        .filter((a) => effectiveActStatus(a.actLine.act, asOf) === "SIGNED")
        .map((a) => ({ label: `${a.workItem.code ? a.workItem.code + " " : ""}${a.workItem.name}`, source: `АВР № ${a.actLine.act.number}, строка «${a.actLine.description ?? ""}»`, date: a.actLine.act.date.toISOString().slice(0, 10), amount: a.amount.toFixed(2), href: `${p}/acts/${a.actLine.actId}` }));
      total = sumKnown(rows.map((r) => dec(r.actsAccepted))).sum;
      methodology = "Распределения строк подписанных действующих актов на статьи сметы.";
      break;
    }
    case "accountingCost": {
      const allocs = await prisma.transactionAllocation.findMany({
        where: { workItemId: only ?? { not: null }, transaction: { projectId, ...(opts.asOf ? { date: { lte: new Date(opts.asOf + "T23:59:59Z") } } : {}) } },
        include: { workItem: true, transaction: true },
      });
      records = allocs
        .filter((a) => isCostTransaction(a.transaction) && (a.transaction.currency === null || a.transaction.currency === cur))
        .map((a) => ({ label: `${a.workItem!.code ? a.workItem!.code + " " : ""}${a.workItem!.name}`, source: `1С: ${a.transaction.documentNumber ?? "без номера"} (Дт ${a.transaction.account ?? "—"} / Кт ${a.transaction.corrAccount ?? "—"})`, date: a.transaction.date?.toISOString().slice(0, 10) ?? null, amount: a.amount.toFixed(2), href: `${p}/accounting/transactions?item=${a.workItemId}` }));
      total = sumKnown(rows.map((r) => dec(r.accountingCost))).sum;
      methodology = project.costMethodologyConfirmed ? "Подтверждённые операции категорий «Затраты/Корректировка/Сторно», распределённые на статьи." : "Импортированные затраты по 1С (методика не согласована): подтверждённые операции категорий «Затраты/Корректировка/Сторно».";
      break;
    }
    case "contractsTotal": {
      const contracts = await prisma.contract.findMany({ where: { projectId, status: { in: ["ACTIVE", "COMPLETED"] } }, include: { amendments: true, contractor: true } });
      for (const c of contracts.filter((x) => (x.currency ?? cur) === cur)) {
        records.push({ label: `Договор № ${c.number ?? "—"} · ${c.contractor?.name ?? ""}`, source: "Исходная сумма", date: c.date?.toISOString().slice(0, 10) ?? null, amount: c.totalAmount?.toFixed(2) ?? null, href: `${p}/contracts/${c.id}` });
        for (const a of c.amendments.filter((x) => x.isSigned && x.amountDelta)) records.push({ label: `Договор № ${c.number ?? "—"}: доп. соглашение № ${a.number ?? "—"}`, source: "Подписанное доп. соглашение", date: a.date?.toISOString().slice(0, 10) ?? null, amount: a.amountDelta!.toFixed(2), href: `${p}/contracts/${c.id}` });
      }
      const list = await loadContracts(projectId);
      total = sumKnown(list.filter((c) => (c.status === "ACTIVE" || c.status === "COMPLETED") && c.currency === cur).map((c) => dec(c.currentAmount))).sum;
      methodology = "Каждый договор учитывается один раз: исходная сумма + подписанные доп. соглашения.";
      break;
    }
    case "paid": {
      const pays = await prisma.payment.findMany({ where: { projectId, currency: cur }, include: { contract: true } });
      records = pays.map((x) => ({ label: `Платёж ${x.documentNumber ?? ""}`.trim(), source: x.contract ? `Договор № ${x.contract.number}` : "без договора", date: x.date.toISOString().slice(0, 10), amount: x.amount.toFixed(2), href: x.contractId ? `${p}/contracts/${x.contractId}` : null }));
      total = sumKnown(records.map((r) => dec(r.amount))).sum;
      methodology = "Подтверждённые платежи (операции 1С категории «Платёж» с договором).";
      break;
    }
    case "uncovered": {
      const list = rows.filter((r) => r.active && !r.covered && r.plannedCost !== null);
      records = list.map((r) => ({ label: `${r.code ? r.code + " " : ""}${r.name}`, source: r.coverageLabel, date: null, amount: r.plannedCost, href: `${p}/items/${r.id}` }));
      total = reg.coverage.uncoveredValue;
      methodology = "Плановая стоимость действующих статей без подтверждённого распределения на действующий/завершённый договор.";
      break;
    }
  }
  const recordsTotal = sumKnown(records.map((r) => dec(r.amount))).sum;
  const t = total ?? (records.length ? null : new Decimal(0));
  return {
    metric,
    title: EXPLAIN_METRICS[metric],
    methodology,
    total: s(total),
    records,
    recordsTotal: s(recordsTotal),
    matches: (t === null && recordsTotal === null) || (t !== null && recordsTotal !== null && t.minus(recordsTotal).abs().lte("0.01")) || (t !== null && recordsTotal === null && t.isZero()),
    currency: cur,
  };
}
