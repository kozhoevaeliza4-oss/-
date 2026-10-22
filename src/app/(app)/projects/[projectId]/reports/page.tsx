import Link from "next/link";
import { requireProjectAccess } from "@/lib/server/auth";
import { REPORTS } from "@/lib/server/reports";
import { PageHeader } from "@/components/ui";

export default async function ReportsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId);
  return (
    <>
      <PageHeader title="Отчёты" subtitle="Фильтрация по объекту, периоду, статье, подрядчику и статусу; экспорт в XLSX и PDF с датой формирования, фильтрами и методикой" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(REPORTS).map(([k, r], i) => (
          <Link key={k} href={`/projects/${projectId}/reports/${k}`} className="card block p-4 transition hover:border-blue-400 hover:shadow">
            <div className="text-xs text-slate-400">{i + 1}</div>
            <div className="font-semibold text-slate-900">{r.title}</div>
            <div className="mt-1 text-sm text-slate-600">{r.description}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
