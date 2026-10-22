import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { actLimitViolations, findDuplicateActs } from "@/lib/server/services/act";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, isoDate } from "@/lib/format";
import { ACT_STATUS } from "@/lib/labels";
import { dec, sumKnown } from "@/lib/calc/decimal";
import { ActEditor } from "../ActEditor";
import { ActStatusForm, DuplicateDecisionForm } from "./ActForms";
import { changeActStatusAction, createCorrectionAction, duplicateDecisionAction, updateActAction } from "../actions";

export default async function ActPage({ params, searchParams }: { params: Promise<{ projectId: string; actId: string }>; searchParams: Promise<{ confirmed?: string; edit?: string }> }) {
  const { projectId, actId } = await params;
  const sp = await searchParams;
  const access = await requireProjectAccess(projectId, "act.view");
  const act = await prisma.act.findFirst({
    where: { id: actId, projectId },
    include: {
      contract: { include: { contractor: true } },
      contractor: true,
      document: true,
      correctsAct: true,
      corrections: true,
      recognition: { include: { pages: { orderBy: { sortOrder: "asc" } } } },
      lines: { orderBy: { sortOrder: "asc" }, include: { allocations: { include: { workItem: true } } } },
    },
  });
  if (!act) notFound();
  const total = sumKnown(act.lines.map((l) => dec(l.amount))).sum;
  const editable = ["DRAFT", "ON_APPROVAL", "REJECTED"].includes(act.status);
  const [violations, dups, audit, contracts, contractors, users] = await Promise.all([
    actLimitViolations(projectId, actId),
    findDuplicateActs(projectId, { number: act.number, date: act.date.toISOString().slice(0, 10), contractorId: act.contractorId, contractId: act.contractId, total: total?.toFixed(2) ?? null, excludeActId: act.id }),
    prisma.auditLog.findMany({ where: { entityType: "Act", entityId: actId }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } }),
    editable ? prisma.contract.findMany({ where: { projectId, status: { not: "TERMINATED" } }, include: { contractor: true } }) : Promise.resolve([]),
    editable ? prisma.contractor.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.user.findMany({ where: { id: { in: [act.signedById, act.createdById, act.limitOverrideById].filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";
  const otherDups = dups.filter((d) => d.actId !== act.correctsActId && !act.corrections.some((c) => c.id === d.actId));
  const canEdit = access.can("act.edit");

  return (
    <>
      <PageHeader
        title={<>АВР № {act.number} <span className="text-base font-normal text-slate-500">от {fmtDate(act.date)}</span></>}
        subtitle={<>{act.contract ? <>Договор <Link className="link" href={`/projects/${projectId}/contracts/${act.contract.id}`}>№ {act.contract.number}</Link></> : <span className="text-red-700">Без договора</span>} · {act.contractor?.name ?? act.contractorName ?? "подрядчик не указан"}{act.periodFrom && ` · период ${fmtDate(act.periodFrom)} – ${fmtDate(act.periodTo)}`}</>}
        actions={<><Badge tone={ACT_STATUS[act.status].tone}>{ACT_STATUS[act.status].label}</Badge><Link href={`/projects/${projectId}/acts`} className="btn-secondary">К реестру АВР</Link></>}
      />
      {sp.confirmed && (
        <div role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Акт создан по распознанному документу в статусе «{ACT_STATUS[act.status].label}». В «принято по АВР» он войдёт только после отметки о подписании. Платежи, проводки и физическое выполнение не создавались.
        </div>
      )}
      {act.isCorrection && act.correctsAct && (
        <p className="mb-3 text-sm">Корректировочный акт к <Link className="link" href={`/projects/${projectId}/acts/${act.correctsAct.id}`}>АВР № {act.correctsAct.number}</Link>. После подписания исходный акт получит статус «скорректирован» и будет исключён из расчёта.</p>
      )}
      {act.corrections.length > 0 && (
        <p className="mb-3 text-sm">Корректировки: {act.corrections.map((c) => <Link key={c.id} className="link mr-2" href={`/projects/${projectId}/acts/${c.id}`}>№ {c.number} ({ACT_STATUS[c.status].label})</Link>)}</p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Сумма строк" value={fmtMoney(total, act.currency, "—")} />
        <Stat label="Итог по документу" value={fmtMoney(act.documentTotal?.toString(), act.currency, "Не указан")} hint={act.vatAmount ? `в т.ч. НДС ${fmtMoney(act.vatAmount.toString(), act.currency)}` : undefined} />
        <Stat label="Строк" value={act.lines.length} hint={`без статьи: ${act.lines.filter((l) => l.allocations.length === 0).length}`} />
        <Stat label="Подписан" value={act.signedAt ? fmtDate(act.signedAt) : "—"} hint={act.signedById ? userName(act.signedById) : undefined} />
        <Stat label="Источник" value={act.recognition ? "Фото / скан" : act.document ? "Файл" : "Ручной ввод"} hint={`создал: ${userName(act.createdById)}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {editable && canEdit && sp.edit ? (
            <Card title="Редактирование акта" actions={<Link className="link text-xs" href="?">Отмена</Link>}>
              <ActEditor
                action={updateActAction.bind(null, projectId, actId)}
                projectId={projectId}
                header={{
                  number: act.number, date: isoDate(act.date), periodFrom: isoDate(act.periodFrom), periodTo: isoDate(act.periodTo), contractId: act.contractId ?? "", contractorId: act.contractorId ?? "",
                  currency: act.currency, objectText: act.objectText ?? "", documentTotal: act.documentTotal?.toString() ?? "", vatAmount: act.vatAmount?.toString() ?? "", comment: act.comment ?? "",
                }}
                lines={act.lines.map((l) => ({
                  key: l.id, lineNo: l.lineNo ?? "", code: l.code ?? "", description: l.description ?? "", unit: l.unit ?? "", quantity: l.quantity?.toString() ?? "", unitPrice: l.unitPrice?.toString() ?? "", amount: l.amount.toString(), note: l.note ?? "",
                  allocations: l.allocations.map((a) => ({ workItemId: a.workItemId, label: `${a.workItem.code ?? ""} ${a.workItem.name}`.trim(), quantity: a.quantity?.toString() ?? "", amount: a.amount.toString() })),
                }))}
                contracts={contracts.map((c) => ({ id: c.id, label: `№ ${c.number ?? "—"} · ${c.contractor?.name ?? ""}`, contractorId: c.contractorId }))}
                contractors={contractors}
                submitLabel="Сохранить акт"
              />
            </Card>
          ) : (
            <Card title={`Позиции (${act.lines.length})`} actions={editable && canEdit ? <Link className="btn-secondary btn-sm" href="?edit=1">Редактировать</Link> : undefined}>
              {act.lines.length === 0 ? <EmptyState>Строк нет.</EmptyState> : (
                <div className="overflow-x-auto">
                  <table className="table-base text-xs">
                    <thead><tr><th>№</th><th>Шифр</th><th>Наименование</th><th>Ед.</th><th className="text-right">Кол-во</th><th className="text-right">Цена</th><th className="text-right">Сумма</th><th>Статьи сметы</th></tr></thead>
                    <tbody>
                      {act.lines.map((l) => {
                        const q = dec(l.quantity);
                        const p = dec(l.unitPrice);
                        const mismatch = q && p && q.times(p).minus(l.amount.toString()).abs().gt(1);
                        return (
                          <tr key={l.id} className={mismatch ? "bg-red-50" : ""}>
                            <td>{l.lineNo ?? ""}</td>
                            <td className="whitespace-nowrap">{l.code ?? ""}</td>
                            <td className="min-w-[200px]">{l.description}{l.note && <div className="text-amber-700">{l.note}</div>}{l.pageNumber && <div className="text-slate-400">стр. {l.pageNumber}</div>}</td>
                            <td>{l.unit ?? ""}</td>
                            <td className="num">{fmtNum(l.quantity?.toString(), 4)}</td>
                            <td className="num">{fmtNum(l.unitPrice?.toString())}</td>
                            <td className="num">{fmtMoney(l.amount.toString(), act.currency)}{mismatch && <div className="text-red-700">≠ кол-во × цена</div>}</td>
                            <td className="min-w-[200px]">
                              {l.allocations.length === 0 ? <Badge tone="red">Не найдено соответствие</Badge> : l.allocations.map((a) => (
                                <div key={a.id}><Link className="link" href={`/projects/${projectId}/items/${a.workItemId}`}>{a.workItem.code ? `${a.workItem.code} ` : ""}{a.workItem.name}</Link> — {fmtMoney(a.amount.toString(), act.currency)}{a.quantity && ` · ${fmtNum(a.quantity.toString(), 4)}`}</div>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {act.recognition && (
            <Card title="Исходный документ (фото / скан)" actions={<Link className="link text-xs" href={`/projects/${projectId}/acts/recognition/${act.recognition.id}`}>Протокол распознавания</Link>}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {act.recognition.pages.map((p, i) => (
                  <a key={p.id} href={`/api/recognition-pages/${p.id}?v=processed`} target="_blank" className="block rounded border border-slate-200 p-1 text-center text-xs hover:border-blue-500">
                    {p.processedPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/recognition-pages/${p.id}?v=processed`} alt={`Стр. ${i + 1}`} className="mx-auto max-h-48" />
                    ) : "нет изображения"}
                    <div>Стр. {i + 1}</div>
                  </a>
                ))}
              </div>
              {access.can("document.download") && act.document && <p className="mt-2 text-xs"><a className="link" href={`/api/documents/${act.document.id}`}>Скачать оригинал первой страницы</a> (оригиналы не изменяются)</p>}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Статус акта">
            {canEdit && !["CORRECTED", "ANNULLED"].includes(act.status) ? (
              <ActStatusForm action={changeActStatusAction.bind(null, projectId, actId)} current={act.status} canSign={access.can("act.sign")} canOverride={access.can("act.override")} hasViolations={violations.some((v) => !["NO_CONTRACT_AMOUNT", "UNALLOCATED_LINES"].includes(v.code))} />
            ) : (
              <p className="text-sm">{ACT_STATUS[act.status].label}</p>
            )}
            {act.limitOverride && <p className="mt-2 text-xs text-amber-800">Подписан с исключением по лимитам ({userName(act.limitOverrideById)}): {act.limitOverrideComment}</p>}
            {act.status === "SIGNED" && canEdit && act.corrections.every((c) => ["ANNULLED", "REJECTED"].includes(c.status)) && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <ActionButton action={createCorrectionAction.bind(null, projectId, actId)} label="Создать корректировочный акт" confirm="Создать корректировочный акт? Он заменит этот акт после подписания." />
              </div>
            )}
          </Card>
          <Card title="Контроль лимитов и соответствия">
            {violations.length === 0 ? <Badge tone="green">Нарушений не найдено</Badge> : (
              <ul className="space-y-1 text-xs">{violations.map((v, k) => <li key={k}><Badge tone={v.severity === "critical" ? "red" : "yellow"}>{v.severity === "critical" ? "Критично" : "Проверить"}</Badge> {v.text}{v.excess && ` (превышение ${v.excess})`}</li>)}</ul>
            )}
            <p className="mt-2 text-[11px] text-slate-500">Сверка с договором, объёмами по договору и плановой стоимостью статей. Превышение не блокирует безусловно: подписание возможно с исключением и обоснованием.</p>
          </Card>
          {otherDups.length > 0 && (
            <Card title="Возможные дубликаты" className="border-red-300">
              <ul className="mb-2 space-y-1 text-xs">{otherDups.map((d) => <li key={d.actId}><Link className="link" href={`/projects/${projectId}/acts/${d.actId}`}>№ {d.number} от {d.date}</Link> ({ACT_STATUS[d.status].label}) — {d.reasons.join(", ")}</li>)}</ul>
              {act.duplicateDecision ? <p className="text-xs text-slate-600">Решение: другой документ — {act.duplicateDecision}</p> : canEdit && <DuplicateDecisionForm action={duplicateDecisionAction.bind(null, projectId, actId)} />}
            </Card>
          )}
          <Card title="Реквизиты из документа">
            <dl className="space-y-1 text-xs">
              {[["Заказчик", act.customerName], ["Подрядчик (в документе)", act.contractorName], ["ИНН", act.contractorInn], ["Договор (в документе)", act.contractText], ["Объект", act.objectText], ["Сумма прописью", act.amountInWords], ["Подписанты", act.signatories], ["Комментарий", act.comment]].map(([k, v]) => (
                <div key={k}><dt className="inline text-slate-500">{k}: </dt><dd className="inline">{v || "—"}</dd></div>
              ))}
            </dl>
          </Card>
          <Card title="Журнал">
            <ul className="max-h-72 space-y-1 overflow-auto text-xs">
              {audit.map((a) => <li key={a.id}><span className="text-slate-500">{fmtDateTime(a.createdAt)}</span> · {a.user?.name ?? "система"} · {a.action}{a.comment && ` — ${a.comment}`}</li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
