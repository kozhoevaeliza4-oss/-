import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProjectAccess } from "@/lib/server/auth";
import { EXPLAIN_METRICS, EXPLAIN_REQUIRES, ExplainMetric, explainMetric } from "@/lib/server/explain";
import { prisma } from "@/lib/server/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate, fmtMoney } from "@/lib/format";

export default async function ExplainPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ metric?: string; item?: string; asOf?: string }> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const access = await requireProjectAccess(projectId);
  const metric = (sp.metric ?? "plannedCost") as ExplainMetric;
  if (!(metric in EXPLAIN_METRICS)) notFound();
  const required = EXPLAIN_REQUIRES[metric];
  if (required && !access.can(required)) redirect("/forbidden");
  const item = sp.item ? await prisma.workItem.findFirst({ where: { id: sp.item, projectId } }) : null;
  const e = await explainMetric(projectId, metric, { workItemId: item?.id, asOf: sp.asOf });
  return (
    <>
      <PageHeader
        title={`Расшифровка: ${e.title}`}
        subtitle={<>{item ? <>Статья <Link className="link" href={`/projects/${projectId}/items/${item.id}`}>{item.code} {item.name}</Link></> : "Весь проект"}{sp.asOf && ` · на ${fmtDate(sp.asOf)}`}</>}
        actions={<Link href={item ? `/projects/${projectId}/items/${item.id}` : `/projects/${projectId}`} className="btn-secondary">Назад</Link>}
      />
      <div className="mb-3 flex flex-wrap gap-1 text-xs">
        {(Object.keys(EXPLAIN_METRICS) as ExplainMetric[]).filter((m) => !EXPLAIN_REQUIRES[m] || access.can(EXPLAIN_REQUIRES[m]!)).map((m) => (
          <Link key={m} href={`?metric=${m}${item ? `&item=${item.id}` : ""}${sp.asOf ? `&asOf=${sp.asOf}` : ""}`} className={`rounded border px-2 py-1 ${m === metric ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}>{EXPLAIN_METRICS[m]}</Link>
        ))}
      </div>
      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Показатель: <b>{fmtMoney(e.total, e.currency, "Нет данных")}</b></span>
          <span>Сумма записей: <b>{fmtMoney(e.recordsTotal, e.currency, "—")}</b> ({e.records.length})</span>
          {e.matches ? <Badge tone="green">Сходится с первичными записями</Badge> : <Badge tone="red">Не сходится — проверьте данные</Badge>}
        </div>
        <p className="mt-2 text-xs text-slate-600">{e.methodology}</p>
      </Card>
      <div className="card overflow-x-auto">
        {e.records.length === 0 ? <div className="p-4"><EmptyState>Записей нет.</EmptyState></div> : (
          <table className="table-base text-xs">
            <thead><tr><th>Запись</th><th>Источник</th><th>Дата</th><th className="text-right">Сумма</th></tr></thead>
            <tbody>
              {e.records.map((r, i) => (
                <tr key={i}>
                  <td>{r.href ? <Link className="link" href={r.href}>{r.label}</Link> : r.label}</td>
                  <td>{r.source}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="num">{fmtMoney(r.amount, e.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
