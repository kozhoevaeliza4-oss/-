import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { maxUploadBytes } from "@/lib/server/storage";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { dec, Decimal } from "@/lib/calc/decimal";
import { plannedCost } from "@/lib/calc/workItem";
import { UploadEstimateForm } from "./EstimateForms";
import { uploadEstimateAction } from "./actions";
import { JOB_STATUS, VERSION_STATUS } from "./labels";

export default async function EstimatePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const [versions, jobs] = await Promise.all([
    prisma.estimateVersion.findMany({
      where: { projectId },
      orderBy: { versionNumber: "desc" },
      include: { lines: { select: { quantity: true, unitPrice: true, sourceTotal: true } }, document: { select: { id: true, originalName: true } } },
    }),
    prisma.importJob.findMany({
      where: { projectId, kind: "ESTIMATE" },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { document: { select: { originalName: true } }, createdBy: { select: { name: true } }, estimateVersion: { select: { id: true, versionNumber: true } } },
    }),
  ]);
  const active = versions.find((v) => v.status === "ACTIVE");
  const baseline = versions.find((v) => v.isBaseline);
  const totals = new Map(
    versions.map((v) => [
      v.id,
      v.lines.reduce(
        (acc, l) => {
          const pc = plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) }).value;
          return pc === null ? { ...acc, missing: acc.missing + 1 } : { ...acc, sum: acc.sum.plus(pc) };
        },
        { sum: new Decimal(0), missing: 0 },
      ),
    ]),
  );

  return (
    <>
    <PageHeader title="Смета" />
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="min-w-0 space-y-4 xl:col-span-2">
        <Card
          title="Версии сметы"
          actions={
            baseline && active && baseline.id !== active.id ? (
              <Link href={`/projects/${projectId}/estimate/compare?a=${baseline.id}&b=${active.id}`} className="btn-secondary btn-sm">
                Сравнить первоначальную и действующую
              </Link>
            ) : null
          }
        >
          {versions.length === 0 ? (
            <EmptyState>Смета ещё не загружена.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>№</th><th>Название</th><th>Статус</th><th className="text-right">Строк</th><th className="text-right">Плановая стоимость</th><th>Утверждена</th><th>Файл</th></tr>
                </thead>
                <tbody>
                  {versions.map((v) => {
                    const t = totals.get(v.id)!;
                    return (
                      <tr key={v.id}>
                        <td>v{v.versionNumber}</td>
                        <td>
                          <Link className="link" href={`/projects/${projectId}/estimate/versions/${v.id}`}>{v.name}</Link>
                          {v.isBaseline && <span className="ml-2"><Badge tone="blue">Первоначальная</Badge></span>}
                        </td>
                        <td><Badge tone={VERSION_STATUS[v.status].tone}>{VERSION_STATUS[v.status].label}</Badge></td>
                        <td className="num">{v.lines.length}</td>
                        <td className="num">
                          {fmtMoney(t.sum, v.currency)}
                          {t.missing > 0 && <div className="text-xs text-amber-700">без стоимости: {t.missing}</div>}
                        </td>
                        <td>{fmtDateTime(v.approvedAt)}</td>
                        <td>
                          {v.document && access.can("document.download") ? (
                            <a className="link text-xs" href={`/api/documents/${v.document.id}`}>{v.document.originalName}</a>
                          ) : (
                            <span className="text-xs text-slate-500">{v.document?.originalName ?? "—"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {versions.length > 1 && (
            <form action={`/projects/${projectId}/estimate/compare`} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <label>
                <span className="label">Сравнить версию</span>
                <select name="a" className="input" defaultValue={baseline?.id}>
                  {versions.map((v) => <option key={v.id} value={v.id}>v{v.versionNumber} — {v.name}</option>)}
                </select>
              </label>
              <label>
                <span className="label">с версией</span>
                <select name="b" className="input" defaultValue={active?.id}>
                  {versions.map((v) => <option key={v.id} value={v.id}>v{v.versionNumber} — {v.name}</option>)}
                </select>
              </label>
              <button className="btn-secondary">Сравнить</button>
            </form>
          )}
        </Card>

        <Card title="Журнал импорта смет">
          {jobs.length === 0 ? (
            <EmptyState>Загрузок не было.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Дата</th><th>Файл</th><th>Пользователь</th><th>Статус</th><th>Результат</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(j.createdAt)}</td>
                    <td>
                      {j.status === "PARSED" ? (
                        <Link className="link" href={`/projects/${projectId}/estimate/import/${j.id}`}>{j.document?.originalName}</Link>
                      ) : j.document?.originalName}
                    </td>
                    <td>{j.createdBy.name}</td>
                    <td><Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge></td>
                    <td className="text-xs text-slate-600">
                      {j.error ?? (j.estimateVersion ? <Link className="link" href={`/projects/${projectId}/estimate/versions/${j.estimateVersion.id}`}>версия v{j.estimateVersion.versionNumber}</Link> : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        {access.can("estimate.import") ? (
          <Card title="Загрузить смету">
            <UploadEstimateForm action={uploadEstimateAction.bind(null, projectId)} maxMb={Math.round(maxUploadBytes() / 1024 / 1024)} />
          </Card>
        ) : (
          <Card title="Загрузка сметы"><p className="text-sm text-slate-600">У вас нет права загружать сметы.</p></Card>
        )}
        <Card title="Как это работает">
          <ol className="list-decimal space-y-1 pl-4 text-sm text-slate-600">
            <li>Файл загружается в приватное хранилище, проверяется формат и повторная загрузка.</li>
            <li>Система предлагает сопоставление столбцов; вы проверяете ошибки и предупреждения.</li>
            <li>После подтверждения создаётся <b>черновик версии</b> — реестр не меняется.</li>
            <li>Ответственный сравнивает черновик с действующей сметой и утверждает его. Предыдущая версия сохраняется в истории.</li>
            <li>Первая утверждённая версия — первоначальная смета ({project.currency}).</li>
          </ol>
        </Card>
      </div>
    </div>
    </>
  );
}
