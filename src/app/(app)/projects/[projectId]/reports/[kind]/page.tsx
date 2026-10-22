import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { buildReport, REPORT_FILTER_KEYS, REPORTS, ReportFilters } from "@/lib/server/reports";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { ACT_STATUS, CLASSIFICATION_STATUS, ISSUE_STATUS } from "@/lib/labels";

const MAX_ROWS = 1000;

export default async function ReportPage({ params, searchParams }: { params: Promise<{ projectId: string; kind: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { projectId, kind } = await params;
  const sp = await searchParams;
  const def = REPORTS[kind];
  if (!def) notFound();
  const access = await requireProjectAccess(projectId, kind === "audit" ? "audit.view" : kind === "unclassified-1c" || kind === "contractors" ? "accounting.view" : "project.view");
  const f: ReportFilters = {};
  for (const k of REPORT_FILTER_KEYS) if (sp[k]) f[k] = sp[k];
  const [report, objects, stages, contractors] = await Promise.all([
    buildReport(projectId, kind, f),
    prisma.constructionObject.findMany({ where: { projectId }, orderBy: { code: "asc" } }),
    prisma.constructionStage.findMany({ where: { projectId }, orderBy: { code: "asc" } }),
    prisma.contractor.findMany({ where: { contracts: { some: { projectId } } }, orderBy: { name: "asc" } }),
  ]);
  if (!report) notFound();
  const qs = new URLSearchParams(Object.entries(f) as [string, string][]).toString();
  const statusOptions: [string, string][] =
    kind === "acts" ? Object.entries(ACT_STATUS).map(([k, v]) => [k, v.label]) : kind === "unclassified-1c" ? Object.entries(CLASSIFICATION_STATUS).map(([k, v]) => [k, v.label]) : kind === "critical" ? Object.entries(ISSUE_STATUS).map(([k, v]) => [k, v.label]) : kind === "coverage" ? [["covered", "Покрыто договором"], ["uncovered", "Без договора"]] : [];
  const cell = (k: string, v: string | null | undefined) => {
    if (v === null || v === undefined || v === "") return <span className="text-slate-400">—</span>;
    if (k === "money") return fmtMoney(v, report.currency);
    if (k === "qty") return fmtNum(v, 4);
    if (k === "pct") return fmtPct(v);
    if (k === "date") return fmtDate(v);
    return v;
  };
  return (
    <>
      <PageHeader
        title={report.title}
        subtitle={def.description}
        actions={
          <>
            {access.can("report.export") && (
              <>
                <a className="btn-secondary" href={`/api/projects/${projectId}/reports/${kind}?format=xlsx${qs ? "&" + qs : ""}`}>Экспорт XLSX</a>
                <a className="btn-secondary" href={`/api/projects/${projectId}/reports/${kind}?format=pdf${qs ? "&" + qs : ""}`}>Экспорт PDF</a>
              </>
            )}
            <Link className="btn-secondary" href={`/projects/${projectId}/reports`}>Все отчёты</Link>
          </>
        }
      />
      {def.filters.length > 0 && (
        <form className="card mb-3 flex flex-wrap items-end gap-2 p-3">
          {def.filters.includes("object") && <label><span className="label">Корпус</span><select name="object" defaultValue={f.object ?? ""} className="input"><option value="">Все</option>{objects.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}</select></label>}
          {def.filters.includes("stage") && <label><span className="label">Этап</span><select name="stage" defaultValue={f.stage ?? ""} className="input"><option value="">Все</option>{stages.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}</select></label>}
          {def.filters.includes("contractor") && <label><span className="label">Подрядчик</span><select name="contractor" defaultValue={f.contractor ?? ""} className="input"><option value="">Все</option>{contractors.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></label>}
          {def.filters.includes("status") && statusOptions.length > 0 && <label><span className="label">Статус</span><select name="status" defaultValue={f.status ?? ""} className="input"><option value="">По умолчанию</option>{statusOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
          {def.filters.includes("q") && <label><span className="label">Статья / поиск</span><input name="q" defaultValue={f.q} className="input" /></label>}
          {def.filters.includes("from") && <label><span className="label">Период с</span><input type="date" name="from" defaultValue={f.from} className="input" /></label>}
          {def.filters.includes("to") && <label><span className="label">по</span><input type="date" name="to" defaultValue={f.to} className="input" /></label>}
          {def.filters.includes("asOf") && <label><span className="label">Состояние на дату</span><input type="date" name="asOf" defaultValue={f.asOf} className="input" /></label>}
          <button className="btn-secondary">Сформировать</button>
          <Link className="btn-secondary" href={`/projects/${projectId}/reports/${kind}`}>Сбросить</Link>
        </form>
      )}
      <Card className="mb-3">
        <p className="text-sm text-slate-700"><b>Методика:</b> {report.methodology}</p>
        {f.asOf && <p className="mt-1 text-sm text-blue-800">Состояние на {fmtDate(f.asOf)} (по датам документов; смета — версия, утверждённая к этой дате).</p>}
        {report.notes.map((n) => <p key={n} className="mt-1 text-sm text-slate-600">{n}</p>)}
      </Card>
      <div className="card overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
        {report.rows.length === 0 ? <div className="p-4"><EmptyState>Нет данных по выбранным фильтрам.</EmptyState></div> : (
          <table className="table-base text-xs">
            <thead className="sticky top-0"><tr>{report.columns.map((c) => <th key={c.key} className={["money", "qty", "pct"].includes(c.kind) ? "text-right" : ""}>{c.label}</th>)}</tr></thead>
            <tbody>
              {report.rows.slice(0, MAX_ROWS).map((r, i) => <tr key={i}>{report.columns.map((c) => <td key={c.key} className={["money", "qty", "pct"].includes(c.kind) ? "num" : ""}>{cell(c.kind, r[c.key])}</td>)}</tr>)}
            </tbody>
            {report.totals && (
              <tfoot className="sticky bottom-0 bg-slate-50 font-semibold"><tr>{report.columns.map((c, i) => <td key={c.key} className={`border-t border-slate-300 ${["money", "qty", "pct"].includes(c.kind) ? "num" : ""}`}>{i === 0 && !report.totals![c.key] ? "Итого" : report.totals![c.key] ? cell(c.kind, report.totals![c.key]) : ""}</td>)}</tr></tfoot>
            )}
          </table>
        )}
        {report.rows.length > MAX_ROWS && <p className="p-2 text-xs text-slate-500">Показаны первые {MAX_ROWS} строк из {report.rows.length}. Полный отчёт — в экспорте.</p>}
      </div>
    </>
  );
}
