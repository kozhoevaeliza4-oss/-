import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { JOB_STATUS } from "../estimate/labels";
import { UploadProgressForm } from "./UploadForm";
import { uploadProgressAction } from "./actions";

export default async function ProgressImportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId, "progress.update");
  const jobs = await prisma.importJob.findMany({
    where: { projectId, kind: "PROGRESS" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { document: { select: { originalName: true } }, createdBy: { select: { name: true } } },
  });
  return (
    <>
      <PageHeader title="Массовое обновление выполнения" subtitle="Через Excel-шаблон с текущими значениями всех статей" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Порядок работы">
          <ol className="mb-4 list-decimal space-y-1 pl-4 text-sm text-slate-600">
            <li>Скачайте шаблон — он содержит все статьи и текущие значения.</li>
            <li>Заполните «Новое значение» (накопленным итогом: объём или %), дату и комментарий только для изменившихся статей. Столбец ID не изменяйте.</li>
            <li>Загрузите файл и проверьте предпросмотр. Изменения применяются только после подтверждения, все строки одной операцией.</li>
            <li>Превышение плана при массовом обновлении записывается как неподтверждённое; подтвердить его можно в карточке статьи.</li>
          </ol>
          <a className="btn-secondary mb-4" href={`/api/projects/${projectId}/progress-template`}>Скачать шаблон</a>
          <UploadProgressForm action={uploadProgressAction.bind(null, projectId)} />
        </Card>
        <Card title="Журнал загрузок" className="xl:col-span-2">
          {jobs.length === 0 ? (
            <EmptyState>Загрузок не было.</EmptyState>
          ) : (
            <table className="table-base text-sm">
              <thead><tr><th>Дата</th><th>Файл</th><th>Пользователь</th><th>Статус</th><th>Результат</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{fmtDateTime(j.createdAt)}</td>
                    <td><Link className="link" href={`/projects/${projectId}/progress-import/${j.id}`}>{j.document?.originalName}</Link></td>
                    <td>{j.createdBy.name}</td>
                    <td><Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge></td>
                    <td className="text-xs">{j.error ?? ((j.summary as { applied?: number } | null)?.applied !== undefined ? `применено: ${(j.summary as { applied: number }).applied}` : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
