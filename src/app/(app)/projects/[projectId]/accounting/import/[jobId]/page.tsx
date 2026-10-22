import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadAccountingJob } from "@/lib/server/services/accounting";
import { ACC_FIELDS } from "@/lib/import/accounting";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { TRANSACTION_CATEGORY } from "@/lib/labels";
import { JOB_STATUS } from "../../../estimate/labels";
import { AccMappingForm } from "./AccMappingForm";
import { accountingMappingAction, cancelAccountingAction, confirmAccountingAction } from "../../actions";

const MAX = 500;

export default async function AccountingImportPage({ params, searchParams }: { params: Promise<{ projectId: string; jobId: string }>; searchParams: Promise<{ only?: string }> }) {
  const { projectId, jobId } = await params;
  const { only } = await searchParams;
  await requireProjectAccess(projectId, "accounting.import");
  const data = await loadAccountingJob(projectId, jobId);
  if (!data) notFound();
  const { job, mapping, sheets, result } = data;
  const summary = job.summary as { inserted?: number; duplicates?: number; errorRows?: { row: number; errors: string[] }[]; sourceTotal?: string; acceptedTotal?: string } | null;
  const base = `/projects/${projectId}/accounting/import/${jobId}`;

  if (job.status !== "PARSED" || !result || !mapping) {
    return (
      <>
        <PageHeader title="Импорт 1С" subtitle={job.document?.originalName} actions={<Badge tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Badge>} />
        <Card>
          {summary ? (
            <ul className="space-y-1 text-sm">
              <li>Добавлено операций: <b>{summary.inserted}</b></li>
              <li>Пропущено (уже загружены ранее): <b>{summary.duplicates}</b></li>
              <li>Сумма файла: {fmtMoney(summary.sourceTotal, "KGS")} · принято новых: {fmtMoney(summary.acceptedTotal, "KGS")}</li>
              {!!summary.errorRows?.length && <li className="text-red-700">Строки с ошибками (не импортированы): {summary.errorRows.map((e) => `стр. ${e.row} (${e.errors.join(", ")})`).join("; ")}</li>}
            </ul>
          ) : <EmptyState>{job.error ?? "Импорт завершён"}</EmptyState>}
          <Link href={`/projects/${projectId}/accounting/transactions`} className="link mt-3 inline-block text-sm">Перейти к классификации операций</Link>
        </Card>
      </>
    );
  }
  const { preview } = result;
  const rows = only === "issues" ? preview.rows.filter((r) => r.errors.length || r.warnings.length || result.nearDuplicates.has(r.rowNumber)) : preview.rows;
  return (
    <>
      <PageHeader title="Импорт выгрузки 1С" subtitle={<>Файл «{job.document?.originalName}», загрузил {job.createdBy.name} {fmtDateTime(job.createdAt)}</>} actions={<Badge tone="yellow">Ожидает подтверждения</Badge>} />
      {result.sameFileImports.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Этот файл уже импортировался {result.sameFileImports.map((s) => fmtDateTime(s.createdAt)).join(", ")}. Все ранее загруженные операции будут пропущены — дублей не возникнет.
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="1. Сопоставление столбцов">
          <AccMappingForm
            action={accountingMappingAction.bind(null, projectId, jobId)}
            sheets={sheets.map((s) => ({ name: s.name, rowCount: s.rows.length, headers: s.rows.slice(0, 40).map((r) => r.map((c) => String(c ?? ""))) }))}
            fields={Object.entries(ACC_FIELDS).map(([key, label]) => ({ key, label }))}
            mapping={mapping}
          />
        </Card>
        <div className="space-y-4 xl:col-span-2">
          <Card title="2. Проверка">
            {preview.mappingErrors.length ? <ul className="list-disc pl-5 text-sm text-red-700">{preview.mappingErrors.map((e) => <li key={e}>{e}</li>)}</ul> : (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="blue">Строк операций: {preview.rows.length}</Badge>
                  <Badge tone="green">Новых: {result.newRows}</Badge>
                  <Badge tone="grey">Уже загружены (пропуск): {preview.rows.filter((r) => result.existing.has(r.fingerprint)).length}</Badge>
                  <Badge tone={preview.errorCount ? "red" : "green"}>С ошибками: {preview.rows.filter((r) => r.errors.length).length}</Badge>
                  <Badge tone={result.nearDuplicates.size ? "yellow" : "green"}>Возможные дубли: {result.nearDuplicates.size}</Badge>
                  <Badge tone="grey">Пропущено служебных: {preview.skipped.length}</Badge>
                </div>
                <div>Сумма строк файла: <b>{fmtMoney(preview.sourceTotal, mapping.defaultCurrency)}</b> · будет принято новых: <b>{fmtMoney(result.newTotal, mapping.defaultCurrency)}</b></div>
                {preview.fileTotals.map((t) => <div key={t.rowNumber} className="text-xs text-slate-600">Итоговая строка файла (стр. {t.rowNumber}) «{t.text}»: {t.values.filter(Boolean).join(" / ") || "—"}</div>)}
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Предварительная классификация новых строк (правила проекта; требует подтверждения)</div>
                  <table className="table-base text-xs">
                    <tbody>{result.categories.map((c) => <tr key={c.category}><td>{c.label}</td><td className="num">{c.count}</td><td className="num">{fmtMoney(c.total, mapping.defaultCurrency)}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
          <Card title="3. Предпросмотр строк" actions={<div className="flex gap-2 text-xs"><Link href={base} className={only ? "link" : "font-semibold"}>Все</Link><Link href={`${base}?only=issues`} className={only ? "font-semibold" : "link"}>С замечаниями</Link></div>}>
            <div className="max-h-[520px] overflow-auto">
              <table className="table-base text-xs">
                <thead className="sticky top-0"><tr><th>Стр.</th><th>Дата</th><th>Документ</th><th>Дт</th><th>Кт</th><th className="text-right">Сумма</th><th>Контрагент</th><th>Аналитика</th><th>Классификация</th><th>Замечания</th></tr></thead>
                <tbody>
                  {rows.slice(0, MAX).map((r) => {
                    const dup = result.existing.has(r.fingerprint);
                    const rule = result.rulesApplied.get(r.rowNumber);
                    return (
                      <tr key={r.rowNumber} className={r.errors.length ? "bg-red-50" : dup ? "bg-slate-50 text-slate-400" : ""}>
                        <td>{r.rowNumber}</td>
                        <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td>{r.documentNumber ?? "—"}</td>
                        <td>{r.account ?? "—"}</td>
                        <td>{r.corrAccount ?? "—"}</td>
                        <td className="num">{fmtMoney(r.amount, r.currency)}</td>
                        <td>{r.counterparty ?? "—"}</td>
                        <td className="max-w-[220px]">{[r.objectText, r.costItemText, r.contractText, r.nomenclature, r.comment].filter(Boolean).join(" · ") || "—"}</td>
                        <td>{dup ? "уже загружена" : rule ? <>{TRANSACTION_CATEGORY[rule.category]} <span className="text-slate-500">(предложено)</span></> : <span className="text-red-700">требует классификации</span>}</td>
                        <td>
                          {r.errors.map((e) => <div key={e} className="text-red-700">Ошибка: {e}</div>)}
                          {r.warnings.map((w) => <div key={w} className="text-amber-800">{w}</div>)}
                          {result.nearDuplicates.has(r.rowNumber) && <div className="text-amber-800">Возможный дубль: совпадают документ, дата и сумма с загруженной операцией</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > MAX && <p className="mt-2 text-xs text-slate-500">Показаны первые {MAX} из {rows.length}.</p>}
            </div>
          </Card>
          <Card title="4. Подтверждение">
            <p className="mb-3 text-sm text-slate-600">Будут записаны {result.newRows} новых операций одной транзакцией. Строки с ошибками не импортируются (их можно исправить в файле и загрузить повторно — уже загруженные строки будут пропущены).</p>
            <div className="flex flex-wrap gap-2">
              <ActionButton action={confirmAccountingAction.bind(null, projectId, jobId)} label="Подтвердить импорт" className="btn-primary" confirm={`Импортировать ${result.newRows} операций на ${result.newTotal}?`} pendingText="Запись…" />
              <ActionButton action={cancelAccountingAction.bind(null, projectId, jobId)} label="Отменить" className="btn-secondary" confirm="Отменить импорт?" />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
