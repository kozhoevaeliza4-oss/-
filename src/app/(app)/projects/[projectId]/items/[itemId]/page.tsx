import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadRegistry } from "@/lib/server/registry";
import { Badge, Card, EmptyState, PageHeader, Stat, type Tone } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtPct, isoDate } from "@/lib/format";
import { dec } from "@/lib/calc/decimal";
import { plannedCost } from "@/lib/calc/workItem";
import { ItemEditForm, ProgressForm } from "../ItemForms";
import { recordProgressAction, updateItemAction } from "../actions";
import { VERSION_STATUS } from "../../estimate/labels";

const LEVEL_TONE: Record<string, Tone> = { green: "green", yellow: "yellow", red: "red", grey: "grey" };
const SOURCE: Record<string, string> = { MANUAL: "Ручной ввод", EXCEL_IMPORT: "Импорт Excel", DOCUMENT: "Документ", SYSTEM: "Система" };
const CONTRACT_STATUS: Record<string, string> = {
  UPLOADED_NEEDS_REVIEW: "Загружен, требуется проверка",
  ACTIVE: "Подписан и действует",
  COMPLETED: "Завершён",
  TERMINATED: "Расторгнут",
  NEEDS_CLARIFICATION: "Требует уточнения",
};

export default async function ItemPage({ params }: { params: Promise<{ projectId: string; itemId: string }> }) {
  const { projectId, itemId } = await params;
  const access = await requireProjectAccess(projectId);
  const item = await prisma.workItem.findFirst({
    where: { id: itemId, projectId },
    include: {
      object: true,
      stage: true,
      section: true,
      progressRecords: { orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }], include: { user: { select: { name: true } }, document: true } },
      estimateLines: { include: { version: true }, orderBy: { version: { versionNumber: "desc" } } },
      allocations: { include: { contract: { include: { contractor: true } } } },
    },
  });
  if (!item) notFound();
  const [data, objects, stages, audit] = await Promise.all([
    loadRegistry(projectId, { workItemId: itemId }),
    prisma.constructionObject.findMany({ where: { projectId }, orderBy: { code: "asc" } }),
    prisma.constructionStage.findMany({ where: { projectId }, orderBy: { code: "asc" } }),
    access.can("audit.view")
      ? prisma.auditLog.findMany({ where: { entityType: "WorkItem", entityId: itemId }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } })
      : Promise.resolve([]),
  ]);
  const r = data.rows[0];
  const cur = data.project.currency;
  const current = item.progressRecords[0];
  const currentValue = current ? (item.measurementType === "QUANTITY" ? current.quantity?.toString() : current.percent?.toString()) ?? null : null;

  return (
    <>
      <PageHeader
        title={<>{item.code && <span className="mr-2 font-mono text-base text-slate-500">{item.code}</span>}{item.name}</>}
        subtitle={
          <>
            {item.section ? `Раздел ${item.section.code} ${item.section.name}` : "Без раздела"} · {item.object?.name ?? "без корпуса"} · {item.stage?.name ?? "без этапа"} · ед. изм.: {item.unit ?? "—"}
            {item.origin === "MANUAL" && " · добавлена вручную"}
          </>
        }
        actions={<><Badge tone={LEVEL_TONE[r.level]}>{r.levelLabel}</Badge><Link href={`/projects/${projectId}/registry`} className="btn-secondary">К реестру</Link></>}
      />

      {r.flags.length > 0 && (
        <div className="mb-4 card p-3">
          <div className="mb-1 text-xs font-semibold text-slate-600">Замечания</div>
          <ul className="space-y-1 text-sm">
            {r.flags.map((f) => (
              <li key={f.code}><Badge tone={f.level === "red" ? "red" : f.level === "yellow" ? "yellow" : "grey"}>{f.level === "red" ? "Критично" : f.level === "yellow" ? "Проверить" : "Нет данных"}</Badge> {f.text}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Плановый объём" value={r.plannedQuantity ? `${fmtNum(r.plannedQuantity, 4)} ${item.unit ?? ""}` : "Нет данных"} hint={r.unitPrice ? `Цена: ${fmtMoney(r.unitPrice, cur)}` : undefined} />
        <Stat label="Плановая стоимость (действующая)" value={fmtMoney(r.plannedCost, cur, "Нет данных")} hint={r.baselinePlannedCost ? `Первоначальная: ${fmtMoney(r.baselinePlannedCost, cur)}` : "Нет в первоначальной смете"} />
        <Stat
          label="Физическая готовность"
          value={r.percentDisplay ? fmtPct(r.percentDisplay) : "Нет данных"}
          hint={r.overrunQuantity ? `Факт ${fmtPct(r.percentRaw)}; превышение ${fmtNum(r.overrunQuantity, 4)} ${item.unit ?? ""} ${r.overrunConfirmed ? "(подтверждено)" : "(не подтверждено)"}` : r.progressAsOf ? `на ${fmtDate(r.progressAsOf)}` : undefined}
          tone={r.overrunQuantity && !r.overrunConfirmed ? "red" : undefined}
        />
        <Stat label="Расчётная стоимость выполненного" value={fmtMoney(r.earnedValue, cur, "Нет данных")} hint={r.unconfirmedOverrunValue ? `+${fmtMoney(r.unconfirmedOverrunValue, cur)} неподтверждённого превышения` : "по плановым расценкам"} />
        <Stat label="Принято по подписанным АВР" value={fmtMoney(r.actsAccepted, cur, "Нет данных")} hint={r.documentedPercent ? `Документально подтверждено ${fmtPct(r.documentedPercent)} от плана` : r.actsPending ? `На согласовании: ${fmtMoney(r.actsPending, cur)}` : undefined} />
        <Stat label={r.accountingCostLabel} value={fmtMoney(r.accountingCost, cur, "Нет данных")} />
        <Stat label="Остаток объёма" value={r.remainingQuantity ? `${fmtNum(r.remainingQuantity, 4)} ${item.unit ?? ""}` : "Нет данных"} tone={r.remainingQuantity && Number(r.remainingQuantity) < 0 ? "red" : undefined} />
        <Stat label="Остаток плановой стоимости" value={fmtMoney(r.remainingCost, cur, "Нет данных")} />
        <Stat label="Выполнено − АВР" value={fmtMoney(r.earnedVsActs, cur, "Нет данных")} hint="Повод для сверки, не задолженность" tone={r.earnedVsActs && Math.abs(Number(r.earnedVsActs)) > 1 ? "yellow" : undefined} />
        <Stat label="Отклонение (факт − план выполненного)" value={fmtMoney(r.variance, cur, "Нет данных")} hint={r.variance && !r.varianceComparable ? "предварительно" : undefined} tone={r.variance && Number(r.variance) > 0 ? "red" : undefined} />
        <Stat label="Прогноз итоговой стоимости" value={r.forecast ? fmtMoney(r.forecast, cur) : "—"} hint={r.forecastReason ?? undefined} />
        <Stat label="Договорное покрытие" value={r.coverageLabel} hint={r.contractAmount ? `По договорам: ${fmtMoney(r.contractAmount, cur)}` : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="История физического выполнения">
            {item.progressRecords.length === 0 ? (
              <EmptyState>Выполнение ещё не вносилось.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base text-xs">
                  <thead>
                    <tr><th>На дату</th><th className="text-right">Было</th><th className="text-right">Стало</th><th>Превышение</th><th>Пользователь</th><th>Внесено</th><th>Источник</th><th>Комментарий</th><th>Документ</th></tr>
                  </thead>
                  <tbody>
                    {item.progressRecords.map((p, i) => {
                      const fmt = (q: unknown, pc: unknown) => (p.method === "QUANTITY" ? (q ? `${fmtNum(String(q), 4)} ${item.unit ?? ""}` : "—") : pc ? fmtPct(String(pc)) : "—");
                      return (
                        <tr key={p.id} className={i === 0 ? "bg-blue-50/40" : ""}>
                          <td className="whitespace-nowrap">{fmtDate(p.asOfDate)}{i === 0 && <div className="text-[10px] text-blue-700">текущее</div>}</td>
                          <td className="num text-slate-500">{fmt(p.previousQuantity, p.previousPercent)}</td>
                          <td className="num font-medium">{fmt(p.quantity, p.percent)}</td>
                          <td>{p.overrunConfirmed ? <Badge tone="yellow">подтверждено</Badge> : "—"}</td>
                          <td>{p.user.name}</td>
                          <td className="whitespace-nowrap">{fmtDateTime(p.createdAt)}</td>
                          <td>{SOURCE[p.source]}</td>
                          <td className="min-w-[200px]">{p.comment}</td>
                          <td>{p.document ? (access.can("document.download") ? <a className="link" href={`/api/documents/${p.document.id}`}>{p.document.originalName}</a> : p.document.originalName) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Плановые значения по версиям сметы">
            {item.estimateLines.length === 0 ? (
              <EmptyState>Статья отсутствует в сметах.</EmptyState>
            ) : (
              <table className="table-base text-xs">
                <thead><tr><th>Версия</th><th>Статус</th><th className="text-right">Объём</th><th className="text-right">Цена</th><th className="text-right">Итог файла</th><th className="text-right">Плановая стоимость</th><th>Источник</th></tr></thead>
                <tbody>
                  {item.estimateLines.map((l) => {
                    const pc = plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) });
                    return (
                      <tr key={l.id}>
                        <td><Link className="link" href={`/projects/${projectId}/estimate/versions/${l.versionId}`}>v{l.version.versionNumber} {l.version.name}</Link>{l.version.isBaseline && <span className="ml-1"><Badge tone="blue">первоначальная</Badge></span>}</td>
                        <td><Badge tone={VERSION_STATUS[l.version.status].tone}>{VERSION_STATUS[l.version.status].label}</Badge></td>
                        <td className="num">{fmtNum(l.quantity?.toString(), 4)}</td>
                        <td className="num">{fmtNum(l.unitPrice?.toString())}</td>
                        <td className="num">{fmtNum(l.sourceTotal?.toString())}</td>
                        <td className="num">{fmtMoney(pc.value, l.currency)}{pc.hasDiscrepancy && <div><Badge tone="yellow">≠ объём × цена</Badge></div>}</td>
                        <td className="text-slate-500">{l.sourceSheet}, стр. {l.sourceRow}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Договоры по статье">
            {item.allocations.length === 0 ? (
              <EmptyState>Договоры не сопоставлены. Статья считается непокрытой договором.</EmptyState>
            ) : (
              <table className="table-base text-xs">
                <thead><tr><th>Договор</th><th>Подрядчик</th><th>Статус договора</th><th>Распределение</th><th className="text-right">Объём</th><th className="text-right">Сумма по статье</th></tr></thead>
                <tbody>
                  {item.allocations.map((a) => (
                    <tr key={a.id}>
                      <td>№ {a.contract.number ?? "—"} от {fmtDate(a.contract.date)}</td>
                      <td>{a.contract.contractor?.name ?? "—"}</td>
                      <td>{CONTRACT_STATUS[a.contract.status]}</td>
                      <td>{a.status === "CONFIRMED" ? <Badge tone="green">подтверждено</Badge> : a.status === "PROPOSED" ? <Badge tone="yellow">предложено</Badge> : <Badge tone="grey">отклонено</Badge>}</td>
                      <td className="num">{fmtNum(a.quantity?.toString(), 4)}</td>
                      <td className="num">{fmtMoney(a.amount?.toString(), a.contract.currency ?? cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {access.can("audit.view") && (
            <Card title="Журнал изменений статьи">
              {audit.length === 0 ? (
                <EmptyState>Записей нет.</EmptyState>
              ) : (
                <ul className="space-y-1 text-xs">
                  {audit.map((a) => (
                    <li key={a.id}>
                      <span className="text-slate-500">{fmtDateTime(a.createdAt)}</span> · {a.user?.name ?? "система"} · <span className="font-mono">{a.action}</span>
                      {a.comment && <> · {a.comment}</>}
                      {a.after && <span className="text-slate-500"> · {JSON.stringify(a.after).slice(0, 200)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {access.can("progress.update") && (
            <Card title="Обновить выполнение">
              <ProgressForm
                action={recordProgressAction.bind(null, projectId, itemId)}
                measurementType={item.measurementType}
                unit={item.unit}
                plannedQuantity={r.plannedQuantity}
                current={currentValue}
                canConfirmOverrun={access.can("progress.confirmOverrun")}
                today={new Date().toISOString().slice(0, 10)}
              />
            </Card>
          )}
          <Card title="Атрибуты статьи">
            {access.can("workitem.edit") ? (
              <ItemEditForm
                action={updateItemAction.bind(null, projectId, itemId)}
                objects={objects.map((o) => ({ id: o.id, name: `${o.code} — ${o.name}` }))}
                stages={stages.map((s) => ({ id: s.id, name: `${s.code} — ${s.name}` }))}
                values={{
                  objectId: item.objectId,
                  stageId: item.stageId,
                  measurementType: item.measurementType,
                  plannedStartDate: isoDate(item.plannedStartDate),
                  plannedEndDate: isoDate(item.plannedEndDate),
                  actualEndDate: isoDate(item.actualEndDate),
                  comment: item.comment,
                  forecastRemainingCost: item.forecastRemainingCost?.toString() ?? null,
                  forecastNote: item.forecastNote,
                }}
              />
            ) : (
              <dl className="space-y-1 text-sm">
                <div>План. завершение: {fmtDate(item.plannedEndDate)}</div>
                <div>Факт. завершение: {fmtDate(item.actualEndDate)}</div>
                <div>Комментарий: {item.comment ?? "—"}</div>
              </dl>
            )}
          </Card>
          <Card title="Источники данных">
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
              {r.sources.map((s) => <li key={s}>{s}</li>)}
              <li>Последнее обновление: {fmtDateTime(r.updatedAt)}</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
