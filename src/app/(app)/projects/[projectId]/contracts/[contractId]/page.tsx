import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadContracts, CONTRACT_FLAG_LABELS } from "@/lib/server/contracts";
import { contractDocumentText } from "@/lib/server/services/contract";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, isoDate } from "@/lib/format";
import { ACT_STATUS, ALLOCATION_STATUS, CONTRACT_STATUS, SIGNING_STATUS } from "@/lib/labels";
import { CONTRACT_FIELD_LABELS } from "@/lib/extract/contract";
import { dec } from "@/lib/calc/decimal";
import { plannedCost } from "@/lib/calc/workItem";
import { AllocationForm, AmendmentForm, ContractForm, OverAllocationForm, StatusForm } from "../ContractForms";
import {
  addAmendmentAction, allocationStatusAction, overAllocationAction, reviewFieldAction, setStatusAction, signAmendmentAction, updateContractAction, upsertAllocationAction,
} from "../actions";

export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; contractId: string }>;
  searchParams: Promise<{ uploaded?: string; text?: string }>;
}) {
  const { projectId, contractId } = await params;
  const sp = await searchParams;
  const access = await requireProjectAccess(projectId, "contract.view");
  const c = await prisma.contract.findFirst({
    where: { id: contractId, projectId },
    include: {
      contractor: true,
      document: true,
      amendments: { orderBy: { createdAt: "asc" }, include: { document: true } },
      allocations: { include: { workItem: { include: { object: true } } }, orderBy: { createdAt: "asc" } },
      acts: { orderBy: { date: "desc" }, include: { lines: { select: { amount: true } } } },
      payments: { orderBy: { date: "desc" } },
    },
  });
  if (!c) notFound();
  const [project, contractors, fields, rows, active] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.contractor.findMany({ orderBy: { name: "asc" } }),
    prisma.extractedField.findMany({ where: { entityType: "Contract", entityId: contractId }, orderBy: { createdAt: "asc" } }),
    loadContracts(projectId),
    prisma.estimateVersion.findFirst({ where: { projectId, status: "ACTIVE" } }),
  ]);
  const row = rows.find((r) => r.id === contractId)!;
  const cur = row.currency;
  const lines = active ? await prisma.estimateLine.findMany({ where: { versionId: active.id, workItemId: { in: c.allocations.map((a) => a.workItemId) } } }) : [];
  const planByItem = new Map(lines.map((l) => [l.workItemId!, plannedCost({ quantity: dec(l.quantity), unitPrice: dec(l.unitPrice), sourceTotal: dec(l.sourceTotal) }).value]));
  const qtyByItem = new Map(lines.map((l) => [l.workItemId!, l.quantity?.toString() ?? null]));
  const pending = fields.filter((f) => f.needsReview);
  const docText = sp.text ? await contractDocumentText(projectId, contractId) : null;
  const canEdit = access.can("contract.edit");
  const canVerify = access.can("contract.verify");

  return (
    <>
      <PageHeader
        title={<>Договор № {c.number ?? "без номера"} {c.date && <span className="text-base font-normal text-slate-500">от {fmtDate(c.date)}</span>}</>}
        subtitle={<>{c.contractor?.name ?? "Подрядчик не указан"}{c.contractor?.inn && ` · ИНН ${c.contractor.inn}`}{c.subject && ` · ${c.subject}`}</>}
        actions={
          <>
            <Badge tone={CONTRACT_STATUS[c.status].tone}>{CONTRACT_STATUS[c.status].label}</Badge>
            <Badge tone={SIGNING_STATUS[c.signingStatus].tone}>{SIGNING_STATUS[c.signingStatus].label}</Badge>
            <Link href={`/projects/${projectId}/contracts`} className="btn-secondary">К реестру договоров</Link>
          </>
        }
      />
      {sp.uploaded && (
        <div role="status" className="mb-4 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          Файл загружен. Распознано полей: {fields.length}. Проверьте каждое значение по исходному фрагменту, исправьте ошибки и подтвердите поля. Договор не учитывается в покрытии до подтверждения.
        </div>
      )}
      {c.comment && <p className="mb-3 whitespace-pre-line text-sm text-amber-800">{c.comment}</p>}
      {row.flags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">{row.flags.map((f) => <Badge key={f} tone="yellow">{CONTRACT_FLAG_LABELS[f]}</Badge>)}</div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Исходная сумма" value={fmtMoney(row.originalAmount, cur, "Нет данных")} />
        <Stat label="Доп. соглашения (подписанные)" value={fmtMoney(row.amendmentsDelta, cur, "—")} />
        <Stat label="Текущая сумма" value={fmtMoney(row.currentAmount, cur, "Нет данных")} />
        <Stat label="Распределено (подтв.)" value={fmtMoney(row.allocatedConfirmed, cur, "—")} hint={row.allocatedProposed ? `предложено: ${fmtMoney(row.allocatedProposed, cur)}` : undefined} />
        <Stat label="Не распределено" value={fmtMoney(row.unallocated, cur, "Нет данных")} tone={row.unallocated && Number(row.unallocated) < 0 ? "red" : undefined} />
        <Stat label="План статей договора" value={fmtMoney(row.plannedCostOfItems, cur, "Нет данных")} />
        <Stat label="Подписанные АВР" value={fmtMoney(row.actsAccepted, cur, "—")} />
        <Stat label="Оплачено" value={fmtMoney(row.paid, cur, "Нет данных")} hint="по платежам 1С" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <Card
            title={`Распределение по статьям сметы (${c.allocations.length})`}
            actions={<span className="text-xs text-slate-500">Покрытие считается только по подтверждённым строкам</span>}
          >
            {c.allocations.length === 0 ? (
              <EmptyState>Статьи не сопоставлены.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base text-xs">
                  <thead><tr><th>Статья</th><th className="text-right">Объём дог. / план</th><th className="text-right">Цена</th><th className="text-right">Сумма по договору</th><th className="text-right">План статьи</th><th>Статус</th><th /></tr></thead>
                  <tbody>
                    {c.allocations.map((a) => {
                      const plan = planByItem.get(a.workItemId) ?? null;
                      const diff = plan && a.amount ? dec(a.amount)!.minus(plan) : null;
                      return (
                        <tr key={a.id}>
                          <td className="min-w-[220px]"><Link className="link" href={`/projects/${projectId}/items/${a.workItemId}`}>{a.workItem.code ? `${a.workItem.code} ` : ""}{a.workItem.name}</Link><div className="text-slate-500">{a.workItem.object?.name ?? ""} · {a.source}</div></td>
                          <td className="num">{fmtNum(a.quantity?.toString(), 4)} / {fmtNum(qtyByItem.get(a.workItemId), 4)} {a.unit ?? ""}</td>
                          <td className="num">{fmtNum(a.unitPrice?.toString())}</td>
                          <td className="num">{fmtMoney(a.amount?.toString(), cur)}</td>
                          <td className="num">{fmtMoney(plan, cur)}{diff && !diff.isZero() && <div className={diff.gt(0) ? "text-red-700" : "text-emerald-700"}>{diff.gt(0) ? "+" : ""}{fmtMoney(diff, cur)}</div>}</td>
                          <td><Badge tone={ALLOCATION_STATUS[a.status].tone}>{ALLOCATION_STATUS[a.status].label}</Badge></td>
                          <td className="space-x-1 whitespace-nowrap text-right">
                            {canVerify && a.status !== "CONFIRMED" && <ActionButton action={allocationStatusAction.bind(null, projectId, a.id, "CONFIRMED")} label="Подтвердить" className="btn-primary btn-sm" />}
                            {canEdit && a.status !== "REJECTED" && <ActionButton action={allocationStatusAction.bind(null, projectId, a.id, "REJECTED")} label="Отклонить" />}
                            {canEdit && <ActionButton action={allocationStatusAction.bind(null, projectId, a.id, "DELETE")} label="Удалить" confirm="Удалить распределение?" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit && <div className="mt-4 border-t border-slate-100 pt-3"><AllocationForm action={upsertAllocationAction.bind(null, projectId, contractId)} projectId={projectId} /></div>}
            {canVerify && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-slate-600">Исключение: распределение сверх суммы договора {c.overAllocationAllowed && <Badge tone="yellow">разрешено</Badge>}</summary>
                <div className="mt-2"><OverAllocationForm action={overAllocationAction.bind(null, projectId, contractId)} allowed={c.overAllocationAllowed} comment={c.overAllocationComment} /></div>
              </details>
            )}
          </Card>

          <Card title={`Дополнительные соглашения (${c.amendments.length})`}>
            {c.amendments.length > 0 && (
              <table className="table-base mb-3 text-xs">
                <thead><tr><th>№</th><th>Дата</th><th>Содержание</th><th className="text-right">Изменение суммы</th><th>Новый срок</th><th>Подписание</th><th>Файл</th></tr></thead>
                <tbody>
                  {c.amendments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.number ?? "—"}</td>
                      <td>{fmtDate(a.date)}</td>
                      <td>{a.description ?? "—"}</td>
                      <td className="num">{fmtMoney(a.amountDelta?.toString(), cur)}</td>
                      <td>{fmtDate(a.newEndDate)}</td>
                      <td>{a.isSigned ? <Badge tone="green">Подписано</Badge> : <span className="space-x-1"><Badge tone="yellow">Не подписано — не учитывается</Badge>{canVerify && <ActionButton action={signAmendmentAction.bind(null, projectId, a.id)} label="Отметить подписанным" confirm="Доп. соглашение подписано сторонами?" />}</span>}</td>
                      <td>{a.document && access.can("document.download") ? <a className="link" href={`/api/documents/${a.document.id}`}>{a.document.originalName}</a> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canEdit && <AmendmentForm action={addAmendmentAction.bind(null, projectId, contractId)} canSign={canVerify} />}
          </Card>

          <Card title={`Акты по договору (${c.acts.length})`} actions={<Link className="link text-xs" href={`/projects/${projectId}/acts?contract=${contractId}`}>Реестр АВР</Link>}>
            {c.acts.length === 0 ? (
              <EmptyState>Актов нет.</EmptyState>
            ) : (
              <table className="table-base text-xs">
                <thead><tr><th>Акт</th><th>Дата</th><th>Статус</th><th className="text-right">Сумма строк</th></tr></thead>
                <tbody>
                  {c.acts.map((a) => (
                    <tr key={a.id}>
                      <td><Link className="link" href={`/projects/${projectId}/acts/${a.id}`}>№ {a.number}</Link>{a.isCorrection && " (корректировочный)"}</td>
                      <td>{fmtDate(a.date)}</td>
                      <td><Badge tone={ACT_STATUS[a.status].tone}>{ACT_STATUS[a.status].label}</Badge></td>
                      <td className="num">{fmtMoney(a.lines.reduce((s, l) => s.plus(l.amount.toString()), dec(0)!), a.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-2">
          {fields.length > 0 && (
            <Card
              title={`Извлечённые данные (${pending.length} требуют проверки)`}
              actions={canEdit && pending.length > 0 ? <ActionButton action={reviewFieldAction.bind(null, projectId, contractId, "all")} label="Подтвердить все" confirm="Вы сверили все значения с документом?" /> : undefined}
            >
              <ul className="space-y-2 text-xs">
                {fields.map((f) => (
                  <li key={f.id} className={`rounded border p-2 ${f.needsReview ? "border-amber-300 bg-amber-50/50" : "border-slate-200"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{CONTRACT_FIELD_LABELS[f.field as keyof typeof CONTRACT_FIELD_LABELS] ?? f.field}: <span className="font-normal">{f.value}</span></span>
                      {f.needsReview ? (canEdit ? <ActionButton action={reviewFieldAction.bind(null, projectId, contractId, f.id)} label="Верно" /> : <Badge tone="yellow">Требует проверки</Badge>) : <Badge tone="green">Проверено {fmtDateTime(f.reviewedAt)}</Badge>}
                    </div>
                    <div className="mt-1 text-slate-500">Источник: {f.location}{f.fragment && <> — «…{f.fragment}…»</>}</div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Если значение распознано неверно — исправьте его в форме реквизитов, затем отметьте поле проверенным.</p>
            </Card>
          )}
          <Card title="Статус договора">
            {canEdit ? <StatusForm action={setStatusAction.bind(null, projectId, contractId)} current={c.status} canVerify={canVerify} /> : <p className="text-sm">{CONTRACT_STATUS[c.status].label}</p>}
            {c.verifiedAt && <p className="mt-2 text-xs text-slate-500">Подтверждён {fmtDateTime(c.verifiedAt)}</p>}
          </Card>
          <Card title="Реквизиты">
            {canEdit ? (
              <ContractForm
                action={updateContractAction.bind(null, projectId, contractId)}
                contractors={contractors}
                defaultCurrency={project.currency}
                pendingFields={pending.map((f) => f.field)}
                values={{
                  contractorId: c.contractorId,
                  contractorInn: c.contractorInn ?? c.contractor?.inn ?? null,
                  number: c.number,
                  date: isoDate(c.date),
                  subject: c.subject,
                  objectText: c.objectText,
                  totalAmount: c.totalAmount?.toString() ?? null,
                  currency: c.currency,
                  startDate: isoDate(c.startDate),
                  endDate: isoDate(c.endDate),
                  paymentTerms: c.paymentTerms,
                  signingStatus: c.signingStatus,
                  comment: c.comment,
                }}
              />
            ) : (
              <dl className="space-y-1 text-sm">
                <div>Объект: {c.objectText ?? "—"}</div>
                <div>Сроки: {fmtDate(c.startDate)} – {fmtDate(c.endDate)}</div>
                <div>Оплата: {c.paymentTerms ?? "—"}</div>
              </dl>
            )}
          </Card>
          <Card title="Документ">
            {c.document ? (
              <div className="space-y-2 text-sm">
                {access.can("document.download") ? <a className="link" href={`/api/documents/${c.document.id}`}>{c.document.originalName}</a> : c.document.originalName}
                <div>
                  {sp.text ? (
                    <Link className="link text-xs" href={`?`}>Скрыть текст</Link>
                  ) : (
                    <Link className="link text-xs" href={`?text=1`}>Показать извлечённый текст</Link>
                  )}
                </div>
                {docText && (
                  <div className="max-h-[500px] space-y-3 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                    {docText.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}
                    {docText.pages.map((p) => (
                      <div key={p.page}>
                        <div className="font-semibold text-slate-600">{p.label}{p.method === "ocr" && ` (OCR, уверенность ${p.confidence?.toFixed(0) ?? "—"}%)`}</div>
                        <pre className="whitespace-pre-wrap font-sans">{p.text}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Файл не загружен (договор введён вручную).</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
