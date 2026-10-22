import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { EmptyState, PageHeader } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { CLASSIFICATION_STATUS, TRANSACTION_CATEGORY } from "@/lib/labels";
import { TransactionsTable } from "./TransactionsTable";
import { classifyAction } from "../actions";

const PAGE_SIZE = 100;

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ status?: string; category?: string; account?: string; q?: string; from?: string; to?: string; unallocated?: string; dup?: string; page?: string; item?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const access = await requireProjectAccess(projectId, "accounting.view");
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AccountingTransactionWhereInput = {
    projectId,
    ...(sp.status ? { classification: sp.status as never } : {}),
    ...(sp.category ? { category: sp.category as never } : {}),
    ...(sp.account ? { OR: [{ account: { startsWith: sp.account } }, { corrAccount: { startsWith: sp.account } }] } : {}),
    ...(sp.from || sp.to ? { date: { ...(sp.from ? { gte: new Date(sp.from + "T00:00:00Z") } : {}), ...(sp.to ? { lte: new Date(sp.to + "T00:00:00Z") } : {}) } } : {}),
    ...(sp.unallocated ? { classification: "CONFIRMED", category: { in: ["COST", "ADJUSTMENT", "REVERSAL"] }, allocations: { none: { workItemId: { not: null } } } } : {}),
    ...(sp.dup ? { possibleDuplicateOfId: { not: null } } : {}),
    ...(sp.item ? { allocations: { some: { workItemId: sp.item } } } : {}),
    ...(sp.q
      ? { AND: [{ OR: ["documentNumber", "counterparty", "objectText", "costItemText", "contractText", "nomenclature", "comment"].map((f) => ({ [f]: { contains: sp.q, mode: "insensitive" } })) }] }
      : {}),
  };
  const [total, sum, txs, project, contracts] = await Promise.all([
    prisma.accountingTransaction.count({ where }),
    prisma.accountingTransaction.aggregate({ where, _sum: { amount: true } }),
    prisma.accountingTransaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { rowNumber: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { rule: { select: { name: true } }, allocations: { include: { workItem: { select: { code: true, name: true } }, contract: { select: { number: true } } } } },
    }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.contract.findMany({ where: { projectId }, include: { contractor: true }, orderBy: { date: "desc" } }),
  ]);
  const base = `/projects/${projectId}/accounting/transactions`;
  const q = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `${base}?${p}`;
  };
  const pages = Math.ceil(total / PAGE_SIZE);
  return (
    <>
      <PageHeader title="Операции 1С" subtitle={`Найдено: ${total} · сумма ${fmtMoney(sum._sum.amount?.toString() ?? null, project.currency)}`} actions={<Link href={`/projects/${projectId}/accounting`} className="btn-secondary">К сводке 1С</Link>} />
      <form className="card mb-3 flex flex-wrap items-end gap-2 p-3" action={base}>
        <label className="min-w-[180px] flex-1"><span className="label">Поиск</span><input name="q" defaultValue={sp.q} className="input" placeholder="Документ, контрагент, аналитика" /></label>
        <label><span className="label">Статус</span><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Все</option>{Object.entries(CLASSIFICATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label><span className="label">Категория</span><select name="category" defaultValue={sp.category ?? ""} className="input"><option value="">Все</option>{Object.entries(TRANSACTION_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span className="label">Счёт</span><input name="account" defaultValue={sp.account} className="input w-24" /></label>
        <label><span className="label">С</span><input type="date" name="from" defaultValue={sp.from} className="input" /></label>
        <label><span className="label">По</span><input type="date" name="to" defaultValue={sp.to} className="input" /></label>
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" name="unallocated" value="1" defaultChecked={!!sp.unallocated} />Затраты без статьи</label>
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" name="dup" value="1" defaultChecked={!!sp.dup} />Возможные дубли</label>
        <button className="btn-secondary">Применить</button>
        <Link href={base} className="btn-secondary">Сбросить</Link>
      </form>
      {txs.length === 0 ? <EmptyState>Операций нет.</EmptyState> : (
        <TransactionsTable
          action={classifyAction.bind(null, projectId)}
          projectId={projectId}
          canClassify={access.can("accounting.classify")}
          categories={Object.entries(TRANSACTION_CATEGORY)}
          contracts={contracts.map((c) => ({ id: c.id, label: `№ ${c.number ?? "—"} · ${c.contractor?.name ?? ""}` }))}
          rows={txs.map((t) => ({
            id: t.id,
            date: t.date?.toISOString().slice(0, 10) ?? null,
            documentNumber: t.documentNumber,
            account: t.account,
            corrAccount: t.corrAccount,
            amount: t.amount?.toString() ?? null,
            currency: t.currency,
            counterparty: t.counterparty,
            analytics: [t.objectText, t.costItemText, t.contractText, t.nomenclature, t.comment].filter(Boolean).join(" · "),
            category: t.category,
            categoryLabel: TRANSACTION_CATEGORY[t.category],
            classification: t.classification,
            classificationLabel: CLASSIFICATION_STATUS[t.classification].label,
            classificationTone: CLASSIFICATION_STATUS[t.classification].tone,
            allocations: t.allocations.map((a) => [a.workItem && `${a.workItem.code ?? ""} ${a.workItem.name}`.trim(), a.contract && `дог. № ${a.contract.number}`, fmtMoney(a.amount.toString(), t.currency ?? project.currency), a.confirmedAt ? "" : "(предложено)"].filter(Boolean).join(" · ")),
            rule: t.rule?.name ?? null,
            possibleDuplicate: !!t.possibleDuplicateOfId,
            exclusionReason: t.exclusionReason,
          }))}
        />
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          {page > 1 && <Link className="link" href={q({ page: String(page - 1) })}>← Назад</Link>}
          <span>Страница {page} из {pages}</span>
          {page < pages && <Link className="link" href={q({ page: String(page + 1) })}>Вперёд →</Link>}
        </div>
      )}
    </>
  );
}
