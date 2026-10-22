import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { ACT_STATUS, RECOGNITION_STATUS } from "@/lib/labels";
import { dec, sumKnown } from "@/lib/calc/decimal";
import { effectiveActStatus } from "@/lib/calc/rules";

export default async function ActsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ status?: string; contract?: string; contractor?: string; q?: string; from?: string; to?: string; unmatched?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const access = await requireProjectAccess(projectId, "act.view");
  const where: Prisma.ActWhereInput = {
    projectId,
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.contract ? { contractId: sp.contract === "none" ? null : sp.contract } : {}),
    ...(sp.contractor ? { contractorId: sp.contractor } : {}),
    ...(sp.q ? { OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { lines: { some: { description: { contains: sp.q, mode: "insensitive" } } } }] } : {}),
    ...(sp.from || sp.to ? { date: { ...(sp.from ? { gte: new Date(sp.from + "T00:00:00Z") } : {}), ...(sp.to ? { lte: new Date(sp.to + "T00:00:00Z") } : {}) } } : {}),
    ...(sp.unmatched ? { lines: { some: { allocations: { none: {} } } } } : {}),
  };
  const [acts, project, contracts, contractors, recs] = await Promise.all([
    prisma.act.findMany({
      where,
      include: { contract: true, contractor: true, lines: { include: { allocations: { select: { id: true } } } }, recognition: { select: { id: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.contract.findMany({ where: { projectId }, include: { contractor: true }, orderBy: { date: "desc" } }),
    prisma.contractor.findMany({ where: { acts: { some: { projectId } } }, orderBy: { name: "asc" } }),
    prisma.actRecognition.findMany({ where: { projectId, status: { notIn: ["CONFIRMED", "CANCELLED"] } }, include: { createdBy: { select: { name: true } }, _count: { select: { pages: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const rows = acts.map((a) => ({ a, total: sumKnown(a.lines.map((l) => dec(l.amount))).sum, unmatched: a.lines.filter((l) => l.allocations.length === 0).length }));
  const accepted = sumKnown(rows.filter((r) => effectiveActStatus(r.a) === "SIGNED" && r.a.currency === project.currency).map((r) => r.total)).sum;
  const pending = sumKnown(rows.filter((r) => ["DRAFT", "ON_APPROVAL"].includes(r.a.status) && r.a.currency === project.currency).map((r) => r.total)).sum;
  const base = `/projects/${projectId}/acts`;

  return (
    <>
      <PageHeader
        title="Акты выполненных работ"
        subtitle="Реестр АВР. В «принято по АВР» входят только подписанные действующие акты (корректировки заменяют исходные акты)."
        actions={
          access.can("act.edit") && (
            <>
              <Link href={`${base}/capture`} className="btn-primary">📷 Сфотографировать АВР</Link>
              <Link href={`${base}/new`} className="btn-secondary">Ввести вручную</Link>
            </>
          )
        }
      />
      {recs.length > 0 && (
        <Card title={`Распознавание: в работе и на проверке (${recs.length})`} className="mb-4">
          <ul className="divide-y divide-slate-100 text-sm">
            {recs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <Link className="link" href={`${base}/recognition/${r.id}`}>Документ от {fmtDateTime(r.createdAt)} · {r._count.pages} стр. · {r.createdBy.name}</Link>
                <Badge tone={RECOGNITION_STATUS[r.status].tone}>{RECOGNITION_STATUS[r.status].label}{r.status === "RECOGNIZING" ? ` ${r.progress}%` : ""}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <form className="card mb-3 flex flex-wrap items-end gap-2 p-3" action={base}>
        <label className="min-w-[180px] flex-1"><span className="label">Поиск</span><input name="q" defaultValue={sp.q} className="input" placeholder="Номер акта или работа" /></label>
        <label><span className="label">Статус</span>
          <select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Все</option>{Object.entries(ACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </label>
        <label><span className="label">Договор</span>
          <select name="contract" defaultValue={sp.contract ?? ""} className="input"><option value="">Все</option><option value="none">Без договора</option>{contracts.map((c) => <option key={c.id} value={c.id}>№ {c.number ?? "—"} · {c.contractor?.name ?? ""}</option>)}</select>
        </label>
        <label><span className="label">Подрядчик</span>
          <select name="contractor" defaultValue={sp.contractor ?? ""} className="input"><option value="">Все</option>{contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label><span className="label">Дата с</span><input type="date" name="from" defaultValue={sp.from} className="input" /></label>
        <label><span className="label">по</span><input type="date" name="to" defaultValue={sp.to} className="input" /></label>
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" name="unmatched" value="1" defaultChecked={!!sp.unmatched} /> Есть строки без статьи</label>
        <button className="btn-secondary">Применить</button>
        {Object.values(sp).some(Boolean) && <Link href={base} className="btn-secondary">Сбросить</Link>}
      </form>
      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <span>Найдено: <b>{rows.length}</b></span>
        <span>Подписано (действующие): <b>{fmtMoney(accepted, project.currency)}</b></span>
        <span>Черновики и на согласовании: <b>{fmtMoney(pending, project.currency)}</b></span>
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-4"><EmptyState>Актов нет.</EmptyState></div>
        ) : (
          <table className="table-base text-xs">
            <thead><tr><th>Акт</th><th>Дата</th><th>Период</th><th>Договор / подрядчик</th><th>Статус</th><th className="text-right">Сумма строк</th><th>Контроль</th></tr></thead>
            <tbody>
              {rows.map(({ a, total, unmatched }) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td>
                    <Link className="link font-medium" href={`${base}/${a.id}`}>№ {a.number}</Link>
                    {a.isCorrection && <div><Badge tone="blue">корректировочный</Badge></div>}
                    {a.recognition && <div className="text-slate-500">по фото</div>}
                  </td>
                  <td>{fmtDate(a.date)}</td>
                  <td className="whitespace-nowrap">{a.periodFrom ? `${fmtDate(a.periodFrom)} – ${fmtDate(a.periodTo)}` : "—"}</td>
                  <td>{a.contract ? <Link className="link" href={`/projects/${projectId}/contracts/${a.contract.id}`}>№ {a.contract.number}</Link> : <span className="text-red-700">без договора</span>}<div className="text-slate-500">{a.contractor?.name ?? a.contractorName ?? "—"}</div></td>
                  <td><Badge tone={ACT_STATUS[a.status].tone}>{ACT_STATUS[a.status].label}</Badge>{a.limitOverride && <div><Badge tone="yellow">исключение по лимитам</Badge></div>}</td>
                  <td className="num">{fmtMoney(total, a.currency)}{a.currency !== project.currency && <div className="text-amber-700">другая валюта</div>}</td>
                  <td className="space-y-0.5">
                    {unmatched > 0 && <div><Badge tone="red">без статьи: {unmatched}</Badge></div>}
                    {a.documentTotal && total && Math.abs(Number(a.documentTotal) - Number(total)) > 1 && !a.vatAmount && <div><Badge tone="yellow">итог ≠ сумме строк</Badge></div>}
                    {!a.documentId && <div className="text-slate-500">без файла</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
