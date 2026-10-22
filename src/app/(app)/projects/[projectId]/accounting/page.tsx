import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { maxUploadBytes } from "@/lib/server/storage";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { CLASSIFICATION_STATUS, TRANSACTION_CATEGORY } from "@/lib/labels";
import { JOB_STATUS } from "../estimate/labels";
import { AccountingUpload } from "./AccountingForms";
import { uploadAccountingAction } from "./actions";

export default async function AccountingPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId, "accounting.view");
  const [project, jobs, byStatus, byCategory, unallocatedCost] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.importJob.findMany({ where: { projectId, kind: "ACCOUNTING" }, orderBy: { createdAt: "desc" }, take: 30, include: { document: true, createdBy: { select: { name: true } }, accountingImport: true } }),
    prisma.accountingTransaction.groupBy({ by: ["classification"], where: { projectId }, _count: true, _sum: { amount: true } }),
    prisma.accountingTransaction.groupBy({ by: ["category"], where: { projectId, classification: "CONFIRMED" }, _count: true, _sum: { amount: true } }),
    prisma.accountingTransaction.count({ where: { projectId, classification: "CONFIRMED", category: { in: ["COST", "ADJUSTMENT", "REVERSAL"] }, allocations: { none: { workItemId: { not: null } } } } }),
  ]);
  const st = (k: string) => byStatus.find((b) => b.classification === k);
  const base = `/projects/${projectId}/accounting`;
  return (
    <>
      <PageHeader
        title="1С и расходы"
        subtitle={project.costMethodologyConfirmed ? "Методика учёта себестоимости согласована" : "Методика учёта не согласована: суммы показываются как «Импортированные затраты по 1С»"}
        actions={<><Link href={`${base}/transactions`} className="btn-primary">Операции</Link><Link href={`${base}/rules`} className="btn-secondary">Правила классификации</Link></>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {(["UNCLASSIFIED", "PROPOSED", "CONFIRMED", "EXCLUDED"] as const).map((k) => (
          <Stat key={k} label={CLASSIFICATION_STATUS[k].label} value={st(k)?._count ?? 0} hint={fmtMoney(st(k)?._sum.amount?.toString() ?? null, project.currency)} href={`${base}/transactions?status=${k}`} tone={k === "UNCLASSIFIED" && (st(k)?._count ?? 0) > 0 ? "red" : k === "PROPOSED" && (st(k)?._count ?? 0) > 0 ? "yellow" : undefined} />
        ))}
        <Stat label="Затраты без статьи" value={unallocatedCost} hint="подтверждены, но не распределены" href={`${base}/transactions?unallocated=1`} tone={unallocatedCost ? "yellow" : undefined} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Подтверждённые операции по категориям">
            {byCategory.length === 0 ? <EmptyState>Подтверждённых операций нет.</EmptyState> : (
              <table className="table-base text-sm">
                <thead><tr><th>Категория</th><th className="text-right">Операций</th><th className="text-right">Сумма</th><th>Учёт в себестоимости статей</th></tr></thead>
                <tbody>
                  {byCategory.map((c) => (
                    <tr key={c.category}>
                      <td><Link className="link" href={`${base}/transactions?category=${c.category}&status=CONFIRMED`}>{TRANSACTION_CATEGORY[c.category]}</Link></td>
                      <td className="num">{c._count}</td>
                      <td className="num">{fmtMoney(c._sum.amount?.toString() ?? null, project.currency)}</td>
                      <td>{["COST", "ADJUSTMENT", "REVERSAL"].includes(c.category) ? <Badge tone="green">входит (при распределении на статью)</Badge> : c.category === "PAYMENT" ? <Badge tone="blue">оплаты по договорам</Badge> : <Badge tone="grey">не входит</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Журнал импорта 1С">
            {jobs.length === 0 ? <EmptyState>Выгрузки ещё не загружались.</EmptyState> : (
              <div className="overflow-x-auto">
                <table className="table-base text-xs">
                  <thead><tr><th>Дата</th><th>Файл</th><th>Пользователь</th><th>Статус</th><th>Период</th><th className="text-right">Строк</th><th className="text-right">Новых</th><th className="text-right">Дубли</th><th className="text-right">Сумма файла</th><th className="text-right">Принято</th></tr></thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id}>
                        <td className="whitespace-nowrap">{fmtDateTime(j.createdAt)}</td>
                        <td>{j.status === "PARSED" ? <Link className="link" href={`${base}/import/${j.id}`}>{j.document?.originalName}</Link> : j.document?.originalName}</td>
                        <td>{j.createdBy.name}</td>
                        <td><Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge>{j.error && <div className="text-red-700">{j.error}</div>}</td>
                        <td className="whitespace-nowrap">{j.accountingImport ? `${fmtDate(j.accountingImport.periodFrom)} – ${fmtDate(j.accountingImport.periodTo)}` : "—"}</td>
                        <td className="num">{j.accountingImport?.rowCount ?? "—"}</td>
                        <td className="num">{j.accountingImport?.newRows ?? "—"}</td>
                        <td className="num">{j.accountingImport?.duplicateRows ?? "—"}</td>
                        <td className="num">{fmtMoney(j.accountingImport?.sourceTotal?.toString() ?? null, project.currency)}</td>
                        <td className="num">{fmtMoney(j.accountingImport?.acceptedTotal?.toString() ?? null, project.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          {access.can("accounting.import") && <Card title="Загрузить выгрузку 1С"><AccountingUpload action={uploadAccountingAction.bind(null, projectId)} maxMb={Math.round(maxUploadBytes() / 1048576)} /></Card>}
          <Card title="Правила учёта">
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
              <li>Назначение счетов 1636/1637 не предполагается: категорию определяют правила проекта и подтверждает бухгалтерия.</li>
              <li>В затраты статьи входят только подтверждённые операции категорий «Затраты», «Корректировка», «Сторно», распределённые на статью (со знаком суммы из файла).</li>
              <li>Повторная загрузка того же файла или пересекающихся периодов не создаёт дублей (отпечаток операции).</li>
              <li>Операции с тем же документом, датой и суммой, но другой аналитикой помечаются «возможный дубль» для проверки.</li>
              <li>Платёж учитывается как оплата по договору, а не как затраты.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
