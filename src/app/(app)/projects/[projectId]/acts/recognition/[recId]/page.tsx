import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { maxUploadBytes } from "@/lib/server/storage";
import { resumeIfNeeded } from "@/lib/server/services/recognition";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { RECOGNITION_STATUS } from "@/lib/labels";
import type { DraftChecks, DraftFields, DraftLine, DraftMatches } from "@/lib/recognition/draft";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { AutoRefresh } from "./AutoRefresh";
import { CaptureForm } from "../../capture/CaptureForm";
import {
  addPagesAction, cancelRecognitionAction, confirmRecognitionAction, manualEntryAction, retryRecognitionAction, saveDraftAction,
} from "../../actions";

export default async function RecognitionPage({ params }: { params: Promise<{ projectId: string; recId: string }> }) {
  const { projectId, recId } = await params;
  const access = await requireProjectAccess(projectId, "act.view");
  await resumeIfNeeded(recId);
  const rec = await prisma.actRecognition.findFirst({
    where: { id: recId, projectId },
    include: { pages: { orderBy: { sortOrder: "asc" }, include: { document: true } }, createdBy: { select: { name: true } }, act: true },
  });
  if (!rec) notFound();
  const canEdit = access.can("act.edit");
  const st = RECOGNITION_STATUS[rec.status];
  const working = rec.status === "QUEUED" || rec.status === "RECOGNIZING";
  const reviewable = rec.status === "NEEDS_REVIEW" || rec.status === "REVIEWED";
  const [project, contracts, contractors, audit] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    reviewable ? prisma.contract.findMany({ where: { projectId, status: { not: "TERMINATED" } }, include: { contractor: true }, orderBy: { date: "desc" } }) : Promise.resolve([]),
    reviewable ? prisma.contractor.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.auditLog.findMany({ where: { entityType: "ActRecognition", entityId: recId }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } }),
  ]);
  const maxMb = Math.round(maxUploadBytes() / 1048576);

  return (
    <>
      {working && <AutoRefresh />}
      <PageHeader
        title="Распознавание АВР"
        subtitle={<>Загружено {fmtDateTime(rec.createdAt)} · {rec.createdBy.name} · страниц: {rec.pages.length}{rec.ocrProvider && ` · OCR: ${rec.ocrProvider} (локально)`}</>}
        actions={<><Badge tone={st.tone}>{st.label}</Badge><Link href={`/projects/${projectId}/acts`} className="btn-secondary">К реестру АВР</Link></>}
      />
      <p className="mb-3 text-xs text-slate-500">Статус распознавания не является юридическим статусом акта. До подтверждения данные не влияют на показатели проекта.</p>

      {working && (
        <Card className="mb-4">
          <div className="mb-2 flex justify-between text-sm"><span>{rec.progressText ?? "Обработка"}</span><span className="tabular-nums">{rec.progress}%</span></div>
          <div className="h-2 rounded bg-slate-100" role="progressbar" aria-valuenow={rec.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-2 rounded bg-blue-600 transition-all" style={{ width: `${rec.progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">Страница обновляется автоматически. Можно закрыть её — обработка продолжится на сервере.</p>
        </Card>
      )}

      {rec.status === "FAILED" && (
        <Card className="mb-4 border-red-300">
          <p className="mb-3 text-sm text-red-800">Распознавание не выполнено: {rec.error}</p>
          <p className="mb-3 text-sm text-slate-600">Исходные файлы сохранены. Можно повторить распознавание, добавить более чёткие фотографии или ввести данные вручную.</p>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <ActionButton action={retryRecognitionAction.bind(null, projectId, recId)} label="Повторить распознавание" className="btn-primary" />
              <ActionButton action={manualEntryAction.bind(null, projectId, recId)} label="Ввести данные вручную" className="btn-secondary" />
              <ActionButton action={cancelRecognitionAction.bind(null, projectId, recId)} label="Отменить загрузку" className="btn-secondary" confirm="Отменить загрузку? Файлы останутся в архиве документов." />
            </div>
          )}
        </Card>
      )}

      {rec.status === "CONFIRMED" && rec.act && (
        <Card className="mb-4 border-emerald-300">
          <p className="text-sm">Документ подтверждён: создан <Link className="link" href={`/projects/${projectId}/acts/${rec.act.id}`}>АВР № {rec.act.number} от {fmtDate(rec.act.date)}</Link>.</p>
        </Card>
      )}
      {rec.status === "CANCELLED" && <Card className="mb-4"><p className="text-sm">Загрузка отменена. Исходные файлы сохранены в архиве документов.</p></Card>}

      {reviewable && canEdit && (
        <ReviewWorkspace
          projectId={projectId}
          recognitionId={recId}
          currency={project.currency}
          pages={rec.pages.map((p) => ({ id: p.id, width: p.width, height: p.height, error: p.error, confidence: p.meanConfidence, hasImage: !!p.processedPath, name: `${p.document.originalName}${p.sourcePage ? `, стр. ${p.sourcePage}` : ""}` }))}
          fields={rec.fields as unknown as DraftFields}
          lines={(rec.lines as unknown as DraftLine[]) ?? []}
          checks={rec.checks as unknown as DraftChecks | null}
          matches={rec.matches as unknown as DraftMatches | null}
          duplicates={rec.duplicates as never}
          duplicateDecision={rec.duplicateDecision}
          contracts={contracts.map((c) => ({ id: c.id, label: `№ ${c.number ?? "—"}${c.date ? ` от ${fmtDate(c.date)}` : ""} · ${c.contractor?.name ?? "подрядчик не указан"}`, contractorId: c.contractorId }))}
          contractors={contractors.map((c) => ({ id: c.id, name: c.name }))}
          saveAction={saveDraftAction.bind(null, projectId, recId)}
          confirmAction={confirmRecognitionAction.bind(null, projectId, recId)}
        />
      )}
      {reviewable && !canEdit && <p className="text-sm text-slate-600">Документ ожидает проверки сотрудником с правом ввода АВР.</p>}

      {canEdit && (reviewable || rec.status === "FAILED") && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Добавить страницу">
            <CaptureForm
              action={addPagesAction.bind(null, projectId, recId)}
              maxMb={maxMb}
              submitLabel="Добавить страницы"
              extra={<label className="flex items-center gap-2 text-sm"><input type="checkbox" name="rerun" defaultChecked /> Сразу распознать документ заново (исправления черновика будут заменены)</label>}
            />
          </Card>
          <Card title="Другие действия">
            <div className="flex flex-wrap gap-2">
              {reviewable && <ActionButton action={retryRecognitionAction.bind(null, projectId, recId)} label="Повторить распознавание" confirm="Распознать заново? Исправления в черновике будут заменены (они сохранены в журнале)." />}
              <ActionButton action={cancelRecognitionAction.bind(null, projectId, recId)} label="Отменить импорт" confirm="Отменить импорт? Файлы останутся в архиве документов." />
            </div>
            <h3 className="mb-1 mt-4 text-xs font-semibold text-slate-600">Журнал</h3>
            <ul className="max-h-60 space-y-1 overflow-auto text-xs">
              {audit.map((a) => (
                <li key={a.id}>
                  <span className="text-slate-500">{fmtDateTime(a.createdAt)}</span> · {a.user?.name ?? "система"} · {a.action}
                  {(a.after as { changes?: string[] } | null)?.changes?.length ? <ul className="ml-4 list-disc text-slate-600">{(a.after as { changes: string[] }).changes.slice(0, 10).map((c, k) => <li key={k}>{c}</li>)}</ul> : null}
                  {a.comment && <span className="text-slate-600"> — {a.comment}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
