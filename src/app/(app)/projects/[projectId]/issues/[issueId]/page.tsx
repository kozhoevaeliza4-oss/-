import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { ISSUE_TYPES } from "@/lib/server/services/issues";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { ISSUE_SEVERITY, ISSUE_STATUS } from "@/lib/labels";
import { updateIssueAction } from "../actions";

export default async function IssuePage({ params }: { params: Promise<{ projectId: string; issueId: string }> }) {
  const { projectId, issueId } = await params;
  const access = await requireProjectAccess(projectId, "issue.view");
  const i = await prisma.issue.findFirst({ where: { id: issueId, projectId }, include: { assignee: true, events: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } } } });
  if (!i) notFound();
  const [project, users] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.user.findMany({ where: { isActive: true, OR: [{ memberships: { some: { projectId } } }, { isAdmin: true }] }, select: { id: true, name: true } }),
  ]);
  const target = i.workItemId ? `/projects/${projectId}/items/${i.workItemId}` : i.contractId ? `/projects/${projectId}/contracts/${i.contractId}` : i.actId ? `/projects/${projectId}/acts/${i.actId}` : i.transactionId ? `/projects/${projectId}/accounting/transactions?dup=1` : null;
  return (
    <div className="max-w-4xl">
      <PageHeader title={ISSUE_TYPES[i.type] ?? i.type} subtitle={i.title} actions={<><Badge tone={ISSUE_SEVERITY[i.severity].tone}>{ISSUE_SEVERITY[i.severity].label}</Badge><Badge tone={ISSUE_STATUS[i.status].tone}>{ISSUE_STATUS[i.status].label}</Badge><Link href={`/projects/${projectId}/issues`} className="btn-secondary">К списку</Link></>} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Карточка">
          <dl className="space-y-1 text-sm">
            <div>Источник: {i.source}</div>
            {i.details && <div>Подробности: {i.details}</div>}
            <div>Сумма отклонения: {fmtMoney(i.amount?.toString() ?? null, project.currency, "не применимо")}</div>
            <div>Обнаружено: {fmtDateTime(i.detectedAt)} · последняя проверка: {fmtDateTime(i.lastSeenAt)}</div>
            <div>Условие {i.isActive ? "обнаруживается" : "больше не обнаруживается"}</div>
            <div>Ответственный: {i.assignee?.name ?? "не назначен"}</div>
            {i.comment && <div>Комментарий: {i.comment}</div>}
          </dl>
          {target && <Link className="link mt-3 inline-block text-sm" href={target}>Перейти к объекту проблемы →</Link>}
        </Card>
        {access.can("issue.manage") && i.status !== "RESOLVED" && (
          <Card title="Работа с проблемой">
            <ActionForm action={updateIssueAction.bind(null, projectId, issueId)}>
              <label className="block"><span className="label">Ответственный</span>
                <select name="assigneeId" defaultValue={i.assigneeId ?? ""} className="input"><option value="">— не назначен —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              </label>
              <label className="block"><span className="label">Статус</span>
                <select name="status" defaultValue="" className="input">
                  <option value="">— без изменения —</option>
                  <option value="ASSIGNED">Назначена</option>
                  <option value="IN_REVIEW">На проверке</option>
                  <option value="NEEDS_DECISION">Требует решения</option>
                  <option value="CLOSED_EXCEPTION">Закрыть с обоснованным исключением</option>
                </select>
              </label>
              <label className="block"><span className="label">Комментарий (для исключения — обязательное обоснование)</span><textarea name="comment" rows={3} className="input" /></label>
              <p className="text-xs text-slate-500">«Устранена» устанавливается автоматически, когда очередная проверка не находит условие.</p>
              <SubmitButton>Сохранить</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
      <Card title="История решения" className="mt-4">
        <ul className="space-y-1 text-sm">
          {i.events.map((e) => (
            <li key={e.id}><span className="text-slate-500">{fmtDateTime(e.createdAt)}</span> · {e.user?.name ?? "система"} · {e.fromStatus && e.toStatus ? `${ISSUE_STATUS[e.fromStatus].label} → ${ISSUE_STATUS[e.toStatus].label}` : e.toStatus ? ISSUE_STATUS[e.toStatus].label : e.action}{e.comment && <> — {e.comment}</>}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
