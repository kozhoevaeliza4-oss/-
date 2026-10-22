import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { ACTION_LABELS } from "@/lib/auditLabels";

const PAGE = 100;

export default async function AuditPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ page?: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId, "audit.view");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { user: { select: { name: true } } } }),
    prisma.auditLog.count({ where: { projectId } }),
  ]);
  return (
    <>
      <PageHeader title="Журнал действий" subtitle={`Загрузки, изменения, утверждения, экспорт и скачивание документов. Всего записей: ${total}`} />
      <Card>
        <div className="overflow-x-auto">
          <table className="table-base text-xs">
            <thead><tr><th>Дата и время</th><th>Пользователь</th><th>Действие</th><th>Объект</th><th>Было</th><th>Стало</th><th>Комментарий</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                  <td>{l.user?.name ?? "система"}</td>
                  <td>{ACTION_LABELS[l.action] ?? l.action}</td>
                  <td>
                    {l.entityType === "WorkItem" && l.entityId ? <Link className="link" href={`/projects/${projectId}/items/${l.entityId}`}>статья</Link> : l.entityType}
                  </td>
                  <td className="max-w-[260px] break-words font-mono text-[10px] text-slate-500">{l.before ? JSON.stringify(l.before).slice(0, 300) : ""}</td>
                  <td className="max-w-[260px] break-words font-mono text-[10px]">{l.after ? JSON.stringify(l.after).slice(0, 300) : ""}</td>
                  <td>{l.comment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex gap-3 text-sm">
          {page > 1 && <Link className="link" href={`?page=${page - 1}`}>← Новее</Link>}
          {page * PAGE < total && <Link className="link" href={`?page=${page + 1}`}>Старее →</Link>}
        </div>
      </Card>
    </>
  );
}
