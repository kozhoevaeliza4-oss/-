/**
 * Контроль акта перед подписанием: договорная сумма и объёмы, плановая стоимость статей, распределение строк.
 * Нарушения не блокируют безусловно — пользователь с правом может оформить исключение с комментарием.
 */
import { Decimal, Num, dec, sumKnown } from "./decimal";

export interface ActLimitInput {
  actTotal: Num;
  hasContract: boolean;
  contractAmount: Num;
  /** Сумма других действующих подписанных актов по договору (без заменяемого исходного акта) */
  otherSignedForContract: Num;
  /** Распределение строк акта по статьям */
  allocations: { workItemId: string; label: string; quantity: Num; amount: Num }[];
  /** Объём статьи по договору */
  contractQtyByItem: Map<string, Num>;
  /** Объём статьи в других подписанных актах по этому договору */
  otherSignedQtyByItem: Map<string, Num>;
  /** Плановая стоимость статьи (действующая смета) */
  plannedCostByItem: Map<string, Num>;
  /** Принято по статье в других подписанных актах (все договоры) */
  otherAcceptedByItem: Map<string, Num>;
  unallocatedLines: number;
}

export interface LimitViolation {
  code: "NO_CONTRACT" | "CONTRACT_AMOUNT_EXCEEDED" | "CONTRACT_VOLUME_EXCEEDED" | "ITEM_PLAN_EXCEEDED" | "UNALLOCATED_LINES" | "NO_CONTRACT_AMOUNT";
  severity: "warning" | "critical";
  text: string;
  excess: string | null;
}

export function checkActLimits(i: ActLimitInput): LimitViolation[] {
  const v: LimitViolation[] = [];
  if (!i.hasContract) v.push({ code: "NO_CONTRACT", severity: "critical", text: "Акт не привязан к договору", excess: null });
  else if (i.contractAmount === null) v.push({ code: "NO_CONTRACT_AMOUNT", severity: "warning", text: "Сумма договора не указана — лимит не проверен", excess: null });
  else if (i.actTotal !== null) {
    const after = (i.otherSignedForContract ?? new Decimal(0)).plus(i.actTotal);
    const excess = after.minus(i.contractAmount);
    if (excess.gt(1))
      v.push({
        code: "CONTRACT_AMOUNT_EXCEEDED",
        severity: "critical",
        text: `Подписанные акты по договору составят ${after.toFixed(2)} при сумме договора ${i.contractAmount.toFixed(2)}`,
        excess: excess.toFixed(2),
      });
  }
  // Агрегируем по статье (одна статья может встречаться в нескольких строках)
  const byItem = new Map<string, { label: string; qty: Num[]; amount: Num[] }>();
  for (const a of i.allocations) {
    const e = byItem.get(a.workItemId) ?? { label: a.label, qty: [], amount: [] };
    e.qty.push(a.quantity);
    e.amount.push(a.amount);
    byItem.set(a.workItemId, e);
  }
  for (const [id, e] of byItem) {
    const qty = sumKnown(e.qty);
    const contractQty = i.contractQtyByItem.get(id) ?? null;
    if (i.hasContract && contractQty !== null && qty.sum !== null && qty.missing === 0) {
      const total = (i.otherSignedQtyByItem.get(id) ?? new Decimal(0)).plus(qty.sum);
      if (total.gt(contractQty))
        v.push({ code: "CONTRACT_VOLUME_EXCEEDED", severity: "warning", text: `${e.label}: объём по актам ${total.toString()} больше объёма по договору ${contractQty.toString()}`, excess: total.minus(contractQty).toString() });
    }
    const plan = i.plannedCostByItem.get(id) ?? null;
    const amount = sumKnown(e.amount).sum;
    if (plan !== null && amount !== null) {
      const total = (i.otherAcceptedByItem.get(id) ?? new Decimal(0)).plus(amount);
      if (total.gt(plan.plus(1)))
        v.push({ code: "ITEM_PLAN_EXCEEDED", severity: "warning", text: `${e.label}: принято по актам ${total.toFixed(2)} больше плановой стоимости ${plan.toFixed(2)}`, excess: total.minus(plan).toFixed(2) });
    }
  }
  if (i.unallocatedLines > 0) v.push({ code: "UNALLOCATED_LINES", severity: "warning", text: `Строк без сопоставления со статьями сметы: ${i.unallocatedLines}`, excess: null });
  return v;
}

export { dec };
