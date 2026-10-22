import Link from "next/link";
import { requireProjectAccess } from "@/lib/server/auth";
import { maxUploadBytes } from "@/lib/server/storage";
import { tesseractEngine } from "@/lib/server/ocr/engine";
import { Card, PageHeader } from "@/components/ui";
import { CaptureForm } from "./CaptureForm";
import { startRecognitionAction } from "../actions";

export default async function CapturePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId, "act.edit");
  const ocr = await tesseractEngine.available();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Сфотографировать АВР" subtitle="Снимите все страницы акта по порядку. Можно добавить готовые фото, сканы или PDF." actions={<Link href={`/projects/${projectId}/acts`} className="btn-secondary">К реестру АВР</Link>} />
      {!ocr.ok && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {ocr.reason}. Документ можно загрузить — оригинал сохранится, данные введёте вручную на экране проверки.
        </div>
      )}
      <Card>
        <CaptureForm action={startRecognitionAction.bind(null, projectId)} maxMb={Math.round(maxUploadBytes() / 1048576)} />
      </Card>
      <Card title="Советы для точного распознавания" className="mt-4">
        <ul className="list-disc space-y-1 pl-4 text-sm text-slate-600">
          <li>Снимайте лист целиком, сверху, без сильного наклона; лист на тёмном фоне определяется лучше.</li>
          <li>Хорошее освещение без бликов и теней; текст должен быть резким.</li>
          <li>Каждую страницу — отдельным снимком, в порядке следования.</li>
          <li>Распознавание выполняется на сервере компании (Tesseract OCR); документы не передаются сторонним сервисам.</li>
          <li>Распознанные данные — черновик: они не влияют на показатели, пока вы их не проверите и не подтвердите. Статус «Подписан» по фото не устанавливается.</li>
        </ul>
      </Card>
    </div>
  );
}
