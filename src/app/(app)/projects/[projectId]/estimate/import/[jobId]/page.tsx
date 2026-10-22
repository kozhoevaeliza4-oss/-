import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadEstimateJob } from "@/lib/server/services/estimate";
import { ESTIMATE_FIELDS } from "@/lib/import/estimate";
import { colLetter } from "@/lib/import/tabular";
import { normKey } from "@/lib/import/estimate";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtMoney, fmtNum } from "@/lib/format";
import { dec } from "@/lib/calc/decimal";
import { MappingForm } from "./MappingForm";
import { SimpleActionButton } from "../../EstimateForms";
import { updateMappingAction, confirmImportAction, cancelImportAction } from "../../actions";
import { JOB_STATUS } from "../../labels";

const MAX_SHOWN = 500;

export default async function ImportJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; jobId: string }>;
  searchParams: Promise<{ only?: string }>;
}) {
  const { projectId, jobId } = await params;
  const { only } = await searchParams;
  const access = await requireProjectAccess(projectId, "estimate.import");
  const data = await loadEstimateJob(projectId, jobId);
  if (!data) notFound();
  const { job, mapping, sheets, preview, parseError } = data;
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { objects: { orderBy: { code: "asc" } }, stages: { orderBy: { code: "asc" } }, sections: true },
  });
  const knownObjects = new Set(project.objects.flatMap((o) => [normKey(o.code), normKey(o.name)]));
  const knownStages = new Set(project.stages.flatMap((s) => [normKey(s.code), normKey(s.name)]));
  const knownSections = new Set(project.sections.map((s) => s.code));
  const base = `/projects/${projectId}/estimate/import/${jobId}`;

  const lastFileTotal = preview?.fileTotals.length ? preview.fileTotals[preview.fileTotals.length - 1] : null;
  const fileTotalDiff = lastFileTotal?.value && preview ? dec(preview.totalPlanned)!.minus(dec(lastFileTotal.value)!) : null;
  const shownLines = preview ? (only === "issues" ? preview.lines.filter((l) => l.issues.some((i) => i.level !== "info")) : preview.lines) : [];

  return (
    <>
      <PageHeader
        title={`Импорт сметы: ${mapping?.meta.name ?? ""}`}
        subtitle={<>Файл «{job.document?.originalName}», загрузил {job.createdBy.name}</>}
        actions={<Badge tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Badge>}
      />
      {job.status !== "PARSED" ? (
        <EmptyState>
          Импорт {JOB_STATUS[job.status].label.toLowerCase()}.{" "}
          {job.estimateVersion && <Link className="link" href={`/projects/${projectId}/estimate/versions/${job.estimateVersion.id}`}>Открыть версию</Link>}
        </EmptyState>
      ) : parseError || !mapping ? (
        <div className="card border-red-300 p-4 text-sm text-red-800">
          Ошибка обработки файла: {parseError}. <Link href={`/projects/${projectId}/estimate`} className="link">Загрузить заново</Link>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4">
            <Card title="1. Сопоставление столбцов">
              <MappingForm
                action={updateMappingAction.bind(null, projectId, jobId)}
                sheets={sheets.map((s) => ({
                  name: s.name,
                  rowCount: s.rows.length,
                  headers: s.rows.slice(0, 60).map((r) => r.map((c, i) => ({ index: i, label: `${colLetter(i)} — ${String(c ?? "").slice(0, 40)}` }))),
                }))}
                fields={Object.entries(ESTIMATE_FIELDS).map(([key, label]) => ({ key, label }))}
                mapping={mapping.estimate}
                objects={project.objects}
                stages={project.stages}
              />
            </Card>
            <Card title="Начало листа (для выбора строки заголовков)">
              <div className="max-h-72 overflow-auto">
                <table className="text-xs">
                  <tbody>
                    {sheets[mapping.estimate.sheetIndex]?.rows.slice(0, 25).map((r, i) => (
                      <tr key={i} className={i + 1 === mapping.estimate.headerRow ? "bg-blue-50 font-semibold" : ""}>
                        <td className="pr-2 text-right text-slate-400">{i + 1}</td>
                        {r.slice(0, 10).map((c, j) => (
                          <td key={j} className="max-w-[140px] truncate border border-slate-100 px-1" title={String(c ?? "")}>{c ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="min-w-0 space-y-4 xl:col-span-2">
            <Card title="2. Проверка данных">
              {preview!.mappingErrors.length > 0 ? (
                <ul className="list-disc pl-5 text-sm text-red-700">{preview!.mappingErrors.map((e) => <li key={e}>{e}</li>)}</ul>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="blue">Строк работ: {preview!.lines.length}</Badge>
                    <Badge tone={preview!.errorCount ? "red" : "green"}>Ошибок: {preview!.errorCount}</Badge>
                    <Badge tone={preview!.warningCount ? "yellow" : "green"}>Предупреждений: {preview!.warningCount}</Badge>
                    <Badge tone="grey">Пропущено служебных строк: {preview!.skipped.length}</Badge>
                    {preview!.linesWithoutCost > 0 && <Badge tone="yellow">Без стоимости: {preview!.linesWithoutCost}</Badge>}
                    {preview!.truncated && <Badge tone="red">Лист обрезан: слишком много строк</Badge>}
                  </div>
                  <div>
                    Сумма плановых стоимостей строк: <b>{fmtMoney(preview!.totalPlanned, project.currency)}</b>
                    {lastFileTotal && (
                      <span className="ml-2">
                        · последняя итоговая строка файла «{lastFileTotal.text}» (стр. {lastFileTotal.rowNumber}): {fmtMoney(lastFileTotal.value, project.currency)}
                        {fileTotalDiff && !fileTotalDiff.isZero() ? (
                          <span className="ml-1"><Badge tone="yellow">расхождение {fmtMoney(fileTotalDiff, project.currency)}</Badge></span>
                        ) : fileTotalDiff ? <span className="ml-1"><Badge tone="green">совпадает</Badge></span> : null}
                      </span>
                    )}
                  </div>
                  {lastFileTotal && fileTotalDiff && !fileTotalDiff.isZero() && (
                    <p className="text-xs text-slate-500">Расхождение с итогом файла возможно, если итог включает накладные расходы, НДС и прочие начисления, которые не являются статьями работ. Проверьте перед подтверждением.</p>
                  )}
                  <div className="grid gap-2 md:grid-cols-3">
                    <NewRefs title="Разделы" items={preview!.sections.map((s) => ({ label: `${s.code} ${s.name}`, isNew: !knownSections.has(s.code) }))} />
                    <NewRefs title="Корпуса" items={preview!.objectCodes.map((c) => ({ label: c, isNew: !knownObjects.has(normKey(c)) }))} />
                    <NewRefs title="Этапы" items={preview!.stageCodes.map((c) => ({ label: c, isNew: !knownStages.has(normKey(c)) }))} />
                  </div>
                </div>
              )}
            </Card>

            <Card
              title="3. Предпросмотр строк"
              actions={
                <div className="flex gap-2 text-xs">
                  <Link href={base} className={only !== "issues" ? "font-semibold" : "link"}>Все</Link>
                  <Link href={`${base}?only=issues`} className={only === "issues" ? "font-semibold" : "link"}>Только с замечаниями</Link>
                </div>
              }
            >
              {shownLines.length === 0 ? (
                <EmptyState>Нет строк для отображения.</EmptyState>
              ) : (
                <div className="max-h-[560px] overflow-auto">
                  <table className="table-base text-xs">
                    <thead className="sticky top-0">
                      <tr><th>Стр.</th><th>Раздел</th><th>Код</th><th>Наименование</th><th>Ед.</th><th className="text-right">Кол-во</th><th className="text-right">Цена</th><th className="text-right">Итог файла</th><th className="text-right">План. стоимость</th><th>Замечания</th></tr>
                    </thead>
                    <tbody>
                      {shownLines.slice(0, MAX_SHOWN).map((l) => {
                        const err = l.issues.some((i) => i.level === "error");
                        const warn = l.issues.some((i) => i.level === "warning");
                        return (
                          <tr key={l.rowNumber} className={err ? "bg-red-50" : warn ? "bg-amber-50/50" : ""}>
                            <td className="text-slate-400">{l.rowNumber}</td>
                            <td>{l.sectionCode ?? "—"}</td>
                            <td className="whitespace-nowrap">{l.code ?? "—"}</td>
                            <td className="min-w-[240px]">{l.name || <i className="text-red-700">нет</i>}{l.objectCode && <div className="text-slate-500">Корпус: {l.objectCode}</div>}</td>
                            <td>{l.unit ?? "—"}</td>
                            <td className="num">{fmtNum(l.quantity, 4)}</td>
                            <td className="num">{fmtNum(l.unitPrice, 2)}</td>
                            <td className="num">{fmtNum(l.total, 2)}</td>
                            <td className="num font-medium">{fmtNum(l.plannedCost, 2)}</td>
                            <td className="min-w-[200px]">
                              {l.issues.map((i, k) => (
                                <div key={k} className={i.level === "error" ? "text-red-700" : i.level === "warning" ? "text-amber-800" : "text-slate-500"}>
                                  {i.level === "error" ? "Ошибка: " : i.level === "warning" ? "Внимание: " : ""}{i.message}
                                </div>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {shownLines.length > MAX_SHOWN && <p className="mt-2 text-xs text-slate-500">Показаны первые {MAX_SHOWN} из {shownLines.length} строк. Импортированы будут все.</p>}
                </div>
              )}
              {preview!.skipped.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-slate-600">Пропущенные строки ({preview!.skipped.length})</summary>
                  <ul className="mt-1 max-h-48 overflow-auto">
                    {preview!.skipped.map((s) => <li key={s.rowNumber}>стр. {s.rowNumber}: {s.reason} — «{s.text.slice(0, 100)}»{s.value ? `, сумма ${s.value}` : ""}</li>)}
                  </ul>
                </details>
              )}
            </Card>

            <Card title="4. Подтверждение">
              <div className="flex flex-wrap items-start gap-3">
                {access.can("estimate.import") && (
                  <>
                    <SimpleActionButton
                      action={confirmImportAction.bind(null, projectId, jobId)}
                      label="Создать черновик версии сметы"
                      pendingText="Запись…"
                      confirm={`Создать черновик версии из ${preview!.lines.length} строк на сумму ${fmtMoney(preview!.totalPlanned, project.currency)}? Реестр не изменится до утверждения.`}
                    />
                    <SimpleActionButton action={cancelImportAction.bind(null, projectId, jobId)} label="Отменить импорт" className="btn-secondary" confirm="Отменить импорт?" />
                  </>
                )}
              </div>
              {preview!.errorCount > 0 && <p className="mt-2 text-sm text-red-700">Подтверждение недоступно, пока есть ошибки ({preview!.errorCount}).</p>}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function NewRefs({ title, items }: { title: string; items: { label: string; isNew: boolean }[] }) {
  return (
    <div className="rounded border border-slate-200 p-2">
      <div className="mb-1 text-xs font-semibold text-slate-600">{title}: {items.length || "нет"}</div>
      <ul className="max-h-32 space-y-0.5 overflow-auto text-xs">
        {items.map((i) => (
          <li key={i.label}>{i.label} {i.isNew && <Badge tone="blue">будет создан</Badge>}</li>
        ))}
      </ul>
    </div>
  );
}
