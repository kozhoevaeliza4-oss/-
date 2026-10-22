import "server-only";
import { prisma } from "./db";
import { dec, Num, sumKnown } from "@/lib/calc/decimal";
import { contractCurrentAmount, contractUnallocated } from "@/lib/calc/coverage";
import { plannedCost } from "@/lib/calc/workItem";
import { effectiveActStatus } from "@/lib/calc/rules";

const s = (v: Num) => (v === null ? null : v.toString());

export type ContractFlag =
  | "PENDING_REVIEW"
  | "NO_ITEMS"
  | "UNALLOCATED"
  | "OVER_ALLOCATED"
  | "OVER_PLAN"
  | "UNDER_PLAN"
  | "EXPIRED"
  | "AMENDED"
  | "ACTS_OVER_CONTRACT"
  | "NO_AMOUNT"
  | "UNCONFIRMED_ALLOCATIONS";

export const CONTRACT_FLAG_LABELS: Record<ContractFlag, string> = {
  PENDING_REVIEW: "Ожидает проверки",
  NO_ITEMS: "Нет сопоставленных статей",
  UNALLOCATED: "Есть нераспределённая сумма",
  OVER_ALLOCATED: "Распределено больше суммы договора",
  OVER_PLAN: "Договор выше плановой стоимости статей",
  UNDER_PLAN: "Договор покрывает меньше плановой стоимости статей",
  EXPIRED: "Истёк срок договора",
  AMENDED: "Сумма изменена доп. соглашениями",
  ACTS_OVER_CONTRACT: "Подписанные АВР превышают сумму договора",
  NO_AMOUNT: "Не указана сумма",
  UNCONFIRMED_ALLOCATIONS: "Есть неподтверждённые распределения",
};

export interface ContractRow {
  id: string;
  number: string | null;
  date: string | null;
  contractor: string | null;
  contractorId: string | null;
  subject: string | null;
  status: string;
  signingStatus: string;
  currency: string;
  originalAmount: string | null;
  currentAmount: string | null;
  amendmentsDelta: string | null;
  allocatedConfirmed: string | null;
  allocatedProposed: string | null;
  unallocated: string | null;
  plannedCostOfItems: string | null;
  itemsCount: number;
  actsAccepted: string | null;
  paid: string | null;
  endDate: string | null;
  flags: ContractFlag[];
  hasDocument: boolean;
}

export async function loadContracts(projectId: string, today = new Date()): Promise<ContractRow[]> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const [contracts, active, pendingFields] = await Promise.all([
    prisma.contract.findMany({
      where: { projectId },
      include: {
        contractor: true,
        amendments: true,
        allocations: true,
        acts: { include: { lines: { select: { amount: true } } } },
        payments: true,
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.estimateVersion.findFirst({ where: { projectId, status: "ACTIVE" } }),
    prisma.extractedField.groupBy({ by: ["entityId"], where: { entityType: "Contract", needsReview: true }, _count: true }),
  ]);
  const pendingSet = new Set(pendingFields.map((p) => p.entityId));
  const lines = active ? await prisma.estimateLine.findMany({ where: { versionId: active.id, workItemId: { not: null } } }) : [];
  const planByItem = new Map(lines.map((l) => [l.workItemId!, plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) }).value]));

  return contracts.map((c) => {
    const currency = c.currency ?? project.currency;
    const signedDeltas = c.amendments.filter((a) => a.isSigned).map((a) => dec(a.amountDelta));
    const current = contractCurrentAmount({ totalAmount: dec(c.totalAmount), amendmentDeltas: signedDeltas });
    const live = c.allocations.filter((a) => a.status !== "REJECTED");
    const confirmed = live.filter((a) => a.status === "CONFIRMED");
    const allocatedConfirmed = sumKnown(confirmed.map((a) => dec(a.amount))).sum;
    const allocatedProposed = sumKnown(live.filter((a) => a.status === "PROPOSED").map((a) => dec(a.amount))).sum;
    const unallocated = contractUnallocated(current.value, live.map((a) => dec(a.amount)));
    const plan = sumKnown(confirmed.map((a) => planByItem.get(a.workItemId) ?? null));
    const signedActs = c.acts.filter((a) => effectiveActStatus(a) === "SIGNED" && a.currency === currency);
    const actsAccepted = sumKnown(signedActs.flatMap((a) => a.lines.map((l) => dec(l.amount)))).sum;
    const paid = sumKnown(c.payments.filter((p) => p.currency === currency).map((p) => dec(p.amount))).sum;

    const flags: ContractFlag[] = [];
    const isLive = c.status === "ACTIVE" || c.status === "COMPLETED";
    if (c.status === "UPLOADED_NEEDS_REVIEW" || c.status === "NEEDS_CLARIFICATION" || pendingSet.has(c.id)) flags.push("PENDING_REVIEW");
    if (isLive && confirmed.length === 0) flags.push("NO_ITEMS");
    if (live.some((a) => a.status === "PROPOSED")) flags.push("UNCONFIRMED_ALLOCATIONS");
    if (current.value === null) flags.push("NO_AMOUNT");
    if (unallocated !== null && unallocated.gt(1)) flags.push("UNALLOCATED");
    if (unallocated !== null && unallocated.lt(-1)) flags.push("OVER_ALLOCATED");
    if (allocatedConfirmed && plan.sum && plan.missing === 0) {
      const d = allocatedConfirmed.minus(plan.sum);
      if (d.gt(1)) flags.push("OVER_PLAN");
      else if (d.lt(-1)) flags.push("UNDER_PLAN");
    }
    if (c.status === "ACTIVE" && c.endDate && c.endDate < today) flags.push("EXPIRED");
    if (signedDeltas.some((d) => d && !d.isZero())) flags.push("AMENDED");
    if (actsAccepted && current.value && actsAccepted.gt(current.value.plus(1))) flags.push("ACTS_OVER_CONTRACT");

    return {
      id: c.id,
      number: c.number,
      date: c.date?.toISOString().slice(0, 10) ?? null,
      contractor: c.contractor?.name ?? null,
      contractorId: c.contractorId,
      subject: c.subject,
      status: c.status,
      signingStatus: c.signingStatus,
      currency,
      originalAmount: c.totalAmount?.toString() ?? null,
      currentAmount: s(current.value),
      amendmentsDelta: s(sumKnown(signedDeltas).sum),
      allocatedConfirmed: s(allocatedConfirmed),
      allocatedProposed: s(allocatedProposed),
      unallocated: s(unallocated),
      plannedCostOfItems: plan.missing === 0 ? s(plan.sum) : null,
      itemsCount: confirmed.length,
      actsAccepted: s(actsAccepted),
      paid: s(paid),
      endDate: c.endDate?.toISOString().slice(0, 10) ?? null,
      flags,
      hasDocument: !!c.documentId,
    };
  });
}
