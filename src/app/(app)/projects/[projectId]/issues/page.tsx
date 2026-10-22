import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { ISSUE_TYPES, syncIssuesIfStale } from "@/lib/server/services/issues";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { ISSUE_SEVERITY, ISSUE_STATUS } from "@/lib/labels";
import { syncIssuesAction } from "./actions";

export default async function IssuesPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ status?: string; severity?: string; type?: string; assignee?: string; all?: string }> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  await requireProjectAccess(projectId, "issue.view");
  await syncIssuesIfStale(projectId);
  const open: IssueStatusFilter = sp.all ? undefined : { in: ["NEW", "ASSIGNED", "IN_REVIEW", "NEEDS_DECISION"] };
  const where: Prisma.IssueWhereInput = {
    projectId,
    ...(sp.status ? { status: sp.status as never } : open ? { status: open } : {}),
    ...(sp.severity ? { severity: sp.severity as never } : {}),
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.assignee ? { assigneeId: sp.assignee === "none" ? null : sp.assignee } : {}),
  };
  const [issues, counts, project, users, last] = await Promise.all([
    prisma.issue.findMany({ where, include: { assignee: { select: { name: true } }, workItem: { select: { id: true } }, contract: { select: { id: true } }, act: { select: { id: true } } }, orderBy: [{ severity: "desc" }, { detectedAt: "desc" }], take: 500 }),
    prisma.issue.groupBy({ by: ["type"], where: { projectId, status: { in: ["NEW", "ASSIGNED", "IN_REVIEW", "NEEDS_DECISION"] } }, _count: true }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.user.findMany({ where: { OR: [{ memberships: { some: { projectId } } }, { isAdmin: true }] }, select: { id: true, name: true } }),
    prisma.issue.aggregate({ where: { projectId }, _max: { lastSeenAt: true } }),
  ]);
  const base = `/projects/${projectId}/issues`;
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `${base}${p.toString() ? "?" + p : ""}`;
  };
  return (
    <>
      <PageHeader title="Проблемы и отклонения" subtitle={`Последняя проверка: ${fmtDateTime(last._max.lastSeenAt)}. Проблема закрывается устранением причины или исключением с обоснованием.`} actions={<ActionButton action={syncIssuesAction.bind(null, projectId)} label="Проверить сейчас" className="btn-secondary" />} />
      <div className="mb-3 flex flex-wrap gap-2">
        {counts.sort((a, b) => b._count - a._count).map((c) => (
          <Link key={c.type} href={link({ type: sp.type === c.type ? undefined : c.type })} className={`rounded border px-2 py-1 text-xs ${sp.type === c.type ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-400"}`}>{ISSUE_TYPES[c.type] ?? c.type}: <b>{c._count}</b></Link>
        ))}
      </div>
      <form className="card mb-3 flex flex-wrap items-end gap-2 p-3" action={base}>
        {sp.type && <input type="hidden" name="type" value={sp.type} />}
        <label><span className="label">Статус</span><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Открытые</option>{Object.entries(ISSUE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label><span className="label">Важность</span><select name="severity" defaultValue={sp.severity ?? ""} className="input"><option value="">Все</option>{Object.entries(ISSUE_SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label><span className="label">Ответственный</span><select name="assignee" defaultValue={sp.assignee ?? ""} className="input"><option value="">Все</option><option value="none">Не назначен</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" name="all" value="1" defaultChecked={!!sp.all} />Включая закрытые</label>
        <button className="btn-secondary">Применить</button>
        <Link href={base} className="btn-secondary">Сбросить</Link>
      </form>
      <div className="card overflow-x-auto">
        {issues.length === 0 ? <div className="p-4"><EmptyState>Открытых проблем нет.</EmptyState></div> : (
          <table className="table-base text-xs">
            <thead><tr><th>Тип</th><th>Объект</th><th>Важность</th><th className="text-right">Сумма</th><th>Источник</th><th>Обнаружено</th><th>Ответственный</th><th>Статус</th></tr></thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td><Link className="link" href={`${base}/${i.id}`}>{ISSUE_TYPES[i.type] ?? i.type}</Link></td>
                  <td className="min-w-[200px]">
                    {i.workItem ? <Link className="link" href={`/projects/${projectId}/items/${i.workItem.id}`}>{i.title}</Link> : i.contract ? <Link className="link" href={`/projects/${projectId}/contracts/${i.contract.id}`}>{i.title}</Link> : i.act ? <Link className="link" href={`/projects/${projectId}/acts/${i.act.id}`}>{i.title}</Link> : i.title}
                    {i.details && <div className="text-slate-500">{i.details}</div>}
                  </td>
                  <td><Badge tone={ISSUE_SEVERITY[i.severity].tone}>{ISSUE_SEVERITY[i.severity].label}</Badge></td>
                  <td className="num">{fmtMoney(i.amount?.toString() ?? null, project.currency)}</td>
                  <td>{i.source}</td>
                  <td className="whitespace-nowrap">{fmtDate(i.detectedAt)}</td>
                  <td>{i.assignee?.name ?? "—"}</td>
                  <td><Badge tone={ISSUE_STATUS[i.status].tone}>{ISSUE_STATUS[i.status].label}</Badge>{!i.isActive && i.status === "CLOSED_EXCEPTION" && <div className="text-slate-500">условие не обнаруживается</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

type IssueStatusFilter = Prisma.EnumIssueStatusFilter | undefined;
