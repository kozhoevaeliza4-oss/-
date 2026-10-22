import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadProgressJob } from "@/lib/server/services/progressImport";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate, fmtNum } from "@/lib/format";
import { JOB_STATUS } from "../../estimate/labels";
import { SimpleActionButton } from "../../estimate/EstimateForms";
import { confirmProgressAction, cancelProgressAction } from "../actions";

export default async function ProgressJobPage({ params }: { params: Promise<{ projectId: string; jobId: string }> }) {
  const { projectId, jobId } = await params;
  await requireProjectAccess(projectId, "progress.update");
  const data = await loadProgressJob(projectId, jobId);
  if (!data) notFound();
  const { job, rows } = data;
  const active = rows.filter((r) => !r.skip);
  const errors = active.filter((r) => r.errors.length);
  const warnings = active.filter((r) => r.warnings.length);
  return (
    <>
      <PageHeader
        title="Проверка массового обновления"
        subtitle={<>Файл «{job.document?.originalName}», загрузил {job.createdBy.name}</>}
        actions={<><Badge tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Badge><Link href={`/projects/${projectId}/progress-import`} className="btn-secondary">Назад</Link></>}
      />
      {job.status !== "PARSED" ? (
        <EmptyState>{job.error ?? `Импорт ${JOB_STATUS[job.status].label.toLowerCase()}.`}</EmptyState>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge tone="blue">К обновлению: {active.length}</Badge>
            <Badge tone="grey">Без изменений: {rows.length - active.length}</Badge>
            <Badge tone={errors.length ? "red" : "green"}>С ошибками: {errors.length}</Badge>
            <Badge tone={warnings.length ? "yellow" : "green"}>С предупреждениями: {warnings.length}</Badge>
          </div>
          <Card title="Строки к обновлению" className="mb-4">
            {active.length === 0 ? (
              <EmptyState>В файле нет заполненных новых значений.</EmptyState>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="table-base text-xs">
                  <thead className="sticky top-0"><tr><th>Стр.</th><th>Статья</th><th>Учёт</th><th className="text-right">План</th><th className="text-right">Текущее</th><th className="text-right">Новое</th><th>Дата</th><th>Комментарий</th><th>Замечания</th></tr></thead>
                  <tbody>
                    {active.map((r) => (
                      <tr key={r.rowNumber} className={r.errors.length ? "bg-red-50" : r.warnings.length ? "bg-amber-50/50" : ""}>
                        <td className="text-slate-400">{r.rowNumber}</td>
                        <td className="min-w-[220px]">{r.name ? <Link className="link" href={`/projects/${projectId}/items/${r.itemId}`}>{r.code ? `${r.code} ` : ""}{r.name}</Link> : <span className="text-red-700">{r.itemId ?? "нет ID"}</span>}</td>
                        <td>{r.measurementType === "PERCENT" ? "%" : r.unit ?? "объём"}</td>
                        <td className="num">{fmtNum(r.plannedQuantity, 4)}</td>
                        <td className="num">{fmtNum(r.current, 4)}</td>
                        <td className="num font-medium">{fmtNum(r.value, 4)}</td>
                        <td>{fmtDate(r.asOfDate)}</td>
                        <td className="min-w-[160px]">{r.comment ?? "—"}</td>
                        <td className="min-w-[200px]">
                          {r.errors.map((e) => <div key={e} className="text-red-700">Ошибка: {e}</div>)}
                          {r.warnings.map((w) => <div key={w} className="text-amber-800">Внимание: {w}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div className="flex gap-3">
            {errors.length === 0 && active.length > 0 && (
              <SimpleActionButton action={confirmProgressAction.bind(null, projectId, jobId)} label={`Применить обновление (${active.length})`} confirm={`Записать выполнение по ${active.length} статьям? Предыдущие значения сохранятся в истории.`} pendingText="Запись…" />
            )}
            <SimpleActionButton action={cancelProgressAction.bind(null, projectId, jobId)} label="Отменить" className="btn-secondary" confirm="Отменить импорт?" />
          </div>
          {errors.length > 0 && <p className="mt-2 text-sm text-red-700">Применение недоступно: исправьте ошибки в файле и загрузите его заново.</p>}
        </>
      )}
    </>
  );
}
