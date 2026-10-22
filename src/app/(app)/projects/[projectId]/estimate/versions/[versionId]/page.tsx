import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { compareVersions } from "@/lib/server/services/estimate";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { dec } from "@/lib/calc/decimal";
import { plannedCost } from "@/lib/calc/workItem";
import { ApproveForm } from "../../EstimateForms";
import { approveVersionAction, rejectVersionAction } from "../../actions";
import { VERSION_STATUS } from "../../labels";
import { DiffSummary, DiffTable } from "../../DiffTable";

export default async function VersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; versionId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { projectId, versionId } = await params;
  const { done } = await searchParams;
  const access = await requireProjectAccess(projectId);
  const version = await prisma.estimateVersion.findFirst({
    where: { id: versionId, projectId },
    include: { lines: { orderBy: { sourceRow: "asc" } }, document: true, importJob: true },
  });
  if (!version) notFound();
  const users = await prisma.user.findMany({
    where: { id: { in: [version.createdById, version.approvedById].filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";

  // Черновик сравнивается с действующей версией; остальные — с предыдущей по номеру
  const compareWith =
    version.status === "DRAFT"
      ? await prisma.estimateVersion.findFirst({ where: { projectId, status: "ACTIVE" } })
      : await prisma.estimateVersion.findFirst({
          where: { projectId, versionNumber: { lt: version.versionNumber }, status: { in: ["ACTIVE", "SUPERSEDED"] } },
          orderBy: { versionNumber: "desc" },
        });
  const diff = await compareVersions(compareWith?.id ?? null, version.id);
  const summary = version.importJob?.summary as { warnings?: number; skipped?: number } | null;

  return (
    <>
      <PageHeader
        title={<>v{version.versionNumber} — {version.name}</>}
        subtitle={
          <>
            Загружена {fmtDateTime(version.createdAt)} ({userName(version.createdById)})
            {version.approvedAt && <> · утверждена {fmtDateTime(version.approvedAt)} ({userName(version.approvedById)})</>}
            {version.document && <> · файл «{version.document.originalName}»</>}
          </>
        }
        actions={
          <>
            {version.isBaseline && <Badge tone="blue">Первоначальная смета</Badge>}
            <Badge tone={VERSION_STATUS[version.status].tone}>{VERSION_STATUS[version.status].label}</Badge>
          </>
        }
      />
      {done === "approved" && version.status === "ACTIVE" && (
        <div role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Версия утверждена и стала действующей. Реестр и показатели пересчитаны. <Link className="link" href={`/projects/${projectId}/registry`}>Открыть реестр</Link>
        </div>
      )}
      {done === "rejected" && version.status === "REJECTED" && (
        <div role="status" className="mb-4 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">Версия отклонена и сохранена в истории без применения.</div>
      )}
      {version.notes && <p className="mb-4 text-sm text-slate-600">{version.notes}</p>}

      {version.status === "DRAFT" && (
        <Card title="Утверждение версии" className="mb-4 border-amber-300">
          <p className="mb-3 text-sm text-slate-700">
            {compareWith
              ? <>Черновик сравнивается с действующей версией v{compareWith.versionNumber} «{compareWith.name}». При утверждении действующая версия будет сохранена в истории, статьи реестра свяжутся по ключу сопоставления, исключённые статьи останутся в реестре с пометкой «нет в действующей смете».</>
              : <>Действующей сметы ещё нет. Эта версия станет <b>первоначальной сметой</b> проекта.</>}
            {summary?.warnings ? <> В данных было {summary.warnings} предупреждений — проверьте таблицу ниже.</> : null}
          </p>
          {access.can("estimate.approve") ? (
            <ApproveForm approve={approveVersionAction.bind(null, projectId, versionId)} reject={rejectVersionAction.bind(null, projectId, versionId)} hasActive={!!compareWith} />
          ) : (
            <p className="text-sm text-slate-500">Утверждение доступно ролям с правом «Утверждение версий смет».</p>
          )}
        </Card>
      )}

      <Card
        title={compareWith ? `Изменения относительно v${compareWith.versionNumber}` : "Состав версии (новые статьи)"}
        className="mb-4"
        actions={compareWith && <Link className="link text-xs" href={`/projects/${projectId}/estimate/compare?a=${compareWith.id}&b=${version.id}`}>Полное сравнение</Link>}
      >
        <div className="mb-3"><DiffSummary diff={diff} currency={version.currency} /></div>
        <DiffTable diff={diff} currency={version.currency} />
      </Card>

      <Card title={`Строки версии (${version.lines.length})`}>
        <div className="max-h-[600px] overflow-auto">
          <table className="table-base text-xs">
            <thead className="sticky top-0">
              <tr><th>Стр. файла</th><th>Раздел</th><th>№</th><th>Код</th><th>Наименование</th><th>Корпус</th><th>Ед.</th><th className="text-right">Кол-во</th><th className="text-right">Цена</th><th className="text-right">Итог файла</th><th className="text-right">План. стоимость</th><th>Статья</th></tr>
            </thead>
            <tbody>
              {version.lines.map((l) => {
                const pc = plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) });
                return (
                  <tr key={l.id}>
                    <td className="text-slate-400">{l.sourceSheet}: {l.sourceRow}</td>
                    <td>{l.sectionCode ?? "—"}</td>
                    <td>{l.lineNo ?? "—"}</td>
                    <td className="whitespace-nowrap">{l.code ?? "—"}</td>
                    <td className="min-w-[220px]">{l.name}</td>
                    <td>{l.objectCode ?? "—"}</td>
                    <td>{l.unit ?? "—"}</td>
                    <td className="num">{fmtNum(l.quantity?.toString(), 4)}</td>
                    <td className="num">{fmtNum(l.unitPrice?.toString())}</td>
                    <td className="num">{fmtNum(l.sourceTotal?.toString())}</td>
                    <td className="num">
                      {fmtMoney(pc.value, l.currency)}
                      {pc.hasDiscrepancy && <div><Badge tone="yellow">≠ объём × цена</Badge></div>}
                    </td>
                    <td>{l.workItemId ? <Link className="link" href={`/projects/${projectId}/items/${l.workItemId}`}>открыть</Link> : <span className="text-slate-400">после утверждения</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
