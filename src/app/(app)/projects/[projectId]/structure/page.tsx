import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate, isoDate } from "@/lib/format";
import { ProjectForm } from "../../ProjectForm";
import {
  updateProjectAction, financeSettingsAction, upsertObjectAction, deleteObjectAction, upsertStageAction, deleteStageAction,
} from "../../actions";
import { ObjectForm, StageForm, DeleteButton, FinanceSettingsForm } from "./StructureForms";

export default async function StructurePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  const canManage = access.can("project.manage");
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      objects: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }], include: { _count: { select: { workItems: true } } } },
      stages: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }], include: { object: true, _count: { select: { workItems: true } } } },
    },
  });
  const objects = project.objects.map((o) => ({ id: o.id, name: `${o.code} — ${o.name}` }));

  return (
    <>
    <PageHeader title="Структура и настройки" />
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <Card title="Корпуса / объекты">
          {project.objects.length === 0 ? (
            <EmptyState>Корпуса не добавлены. Они также создаются при утверждении сметы, если в ней указан корпус.</EmptyState>
          ) : (
            <table className="table-base mb-3">
              <thead><tr><th>Код</th><th>Название</th><th className="text-right">Статей</th><th /></tr></thead>
              <tbody>
                {project.objects.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-xs">{o.code}</td>
                    <td>
                      {canManage ? (
                        <details>
                          <summary className="cursor-pointer">{o.name}</summary>
                          <div className="mt-2"><ObjectForm action={upsertObjectAction.bind(null, projectId, o.id)} values={o} /></div>
                        </details>
                      ) : o.name}
                    </td>
                    <td className="num">{o._count.workItems}</td>
                    <td className="text-right">
                      {canManage && <DeleteButton action={deleteObjectAction.bind(null, projectId, o.id)} confirm={`Удалить корпус «${o.name}»?`} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canManage && <ObjectForm action={upsertObjectAction.bind(null, projectId, null)} />}
        </Card>

        <Card title="Этапы строительства">
          {project.stages.length === 0 ? (
            <EmptyState>Этапы не добавлены.</EmptyState>
          ) : (
            <table className="table-base mb-3">
              <thead><tr><th>Код</th><th>Этап</th><th>Корпус</th><th>Сроки (план)</th><th className="text-right">Статей</th><th /></tr></thead>
              <tbody>
                {project.stages.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono text-xs">{s.code}</td>
                    <td>
                      {canManage ? (
                        <details>
                          <summary className="cursor-pointer">{s.name}</summary>
                          <div className="mt-2">
                            <StageForm
                              action={upsertStageAction.bind(null, projectId, s.id)}
                              objects={objects}
                              values={{ ...s, plannedStart: isoDate(s.plannedStart), plannedEnd: isoDate(s.plannedEnd) }}
                            />
                          </div>
                        </details>
                      ) : s.name}
                    </td>
                    <td>{s.object?.name ?? "Весь проект"}</td>
                    <td className="whitespace-nowrap">{fmtDate(s.plannedStart)} – {fmtDate(s.plannedEnd)}</td>
                    <td className="num">{s._count.workItems}</td>
                    <td className="text-right">
                      {canManage && <DeleteButton action={deleteStageAction.bind(null, projectId, s.id)} confirm={`Удалить этап «${s.name}»?`} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canManage && <StageForm action={upsertStageAction.bind(null, projectId, null)} objects={objects} />}
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Параметры проекта">
          {canManage ? (
            <ProjectForm action={updateProjectAction.bind(null, projectId)} values={project} currencyLocked />
          ) : (
            <dl className="space-y-1 text-sm">
              <div><dt className="inline text-slate-500">Код: </dt><dd className="inline">{project.code}</dd></div>
              <div><dt className="inline text-slate-500">Адрес: </dt><dd className="inline">{project.address ?? "—"}</dd></div>
              <div><dt className="inline text-slate-500">Описание: </dt><dd className="inline">{project.description ?? "—"}</dd></div>
            </dl>
          )}
          <p className="mt-3 text-xs text-slate-500">Базовая валюта ({project.currency}) после создания не меняется, чтобы не исказить исторические суммы.</p>
        </Card>

        <Card title="Финансовая методика">
          <div className="mb-3 flex flex-wrap gap-2">
            {project.costMethodologyConfirmed ? <Badge tone="green">Методика 1С согласована</Badge> : <Badge tone="yellow">Методика 1С не согласована</Badge>}
            {project.forecastModelConfirmed ? <Badge tone="green">Модель прогноза подтверждена</Badge> : <Badge tone="grey">Модель прогноза не подтверждена</Badge>}
          </div>
          {access.can("finance.settings") ? (
            <FinanceSettingsForm action={financeSettingsAction.bind(null, projectId)} values={project} />
          ) : (
            <p className="text-sm text-slate-600">{project.costMethodologyNote ?? "Описание методики отсутствует."}</p>
          )}
        </Card>
      </div>
    </div>
    </>
  );
}
