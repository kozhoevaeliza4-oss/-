import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadRegistry } from "@/lib/server/registry";
import { filtersFromParams } from "@/lib/registryFilter";
import { PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { RegistryTable } from "./RegistryTable";

export default async function RegistryPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  const [data, objects, stages, sections] = await Promise.all([
    loadRegistry(projectId),
    prisma.constructionObject.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.constructionStage.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.estimateSection.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
  ]);
  const contractors = [...new Set(data.rows.flatMap((r) => r.contractors))].sort((a, b) => a.localeCompare(b, "ru"));

  return (
    <>
      <PageHeader
        title="Реестр работ"
        subtitle={
          <>
            {data.currentVersion ? <>Действующая смета: v{data.currentVersion.versionNumber} «{data.currentVersion.name}»</> : "Действующая смета не утверждена"} · расчёт
            выполнен {fmtDateTime(data.computedAt)}
          </>
        }
        actions={
          <>
            {access.can("progress.update") && (
              <Link href={`/projects/${projectId}/progress-import`} className="btn-secondary">Массовое обновление выполнения (Excel)</Link>
            )}
            {access.can("workitem.edit") && (
              <Link href={`/projects/${projectId}/items/new`} className="btn-secondary">Добавить статью вручную</Link>
            )}
          </>
        }
      />
      <RegistryTable
        projectId={projectId}
        currency={data.project.currency}
        rows={data.rows}
        initialFilters={filtersFromParams(await searchParams)}
        options={{
          objects: objects.map((o) => ({ id: o.id, name: `${o.code} — ${o.name}` })),
          stages: stages.map((s) => ({ id: s.id, name: `${s.code} — ${s.name}` })),
          sections: sections.map((s) => ({ id: s.id, name: `${s.code} ${s.name}` })),
          contractors,
        }}
        canExport={access.can("report.export")}
        methodologyConfirmed={data.project.costMethodologyConfirmed}
      />
    </>
  );
}
