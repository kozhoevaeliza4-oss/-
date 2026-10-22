import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadRegistry } from "@/lib/server/registry";
import { applyRegistryFilters, filtersFromParams, sortRegistry } from "@/lib/registryFilter";
import { REGISTRY_COLUMNS } from "@/lib/registryColumns";
import { Decimal } from "@/lib/calc/decimal";
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
  const sp = await searchParams;
  const filters = filtersFromParams(sp);
  const [data, objects, stages, sections] = await Promise.all([
    loadRegistry(projectId, { asOf: filters.asOf }),
    prisma.constructionObject.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.constructionStage.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.estimateSection.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
  ]);
  const contractors = [...new Set(data.rows.flatMap((r) => r.contractors))].sort((a, b) => a.localeCompare(b, "ru"));
  // Фильтрация, сортировка, итоги и пагинация — на сервере
  const sortParam = typeof sp.sort === "string" ? sp.sort : "";
  const [sk, sd] = sortParam.split(":");
  const sort = sk && REGISTRY_COLUMNS.some((c) => c.key === sk) ? { key: sk, dir: (sd === "desc" ? -1 : 1) as 1 | -1 } : null;
  const filtered = sortRegistry(applyRegistryFilters(data.rows, filters), sort);
  const pageSize = 200;
  const page = Math.min(Math.max(1, Number(sp.page) || 1), Math.max(1, Math.ceil(filtered.length / pageSize)));
  const totals = Object.fromEntries(
    REGISTRY_COLUMNS.filter((c) => c.kind === "money").map((c) => {
      let sum = new Decimal(0);
      let missing = 0;
      for (const r of filtered) {
        const v = c.value(r);
        if (v === null) missing++;
        else sum = sum.plus(v);
      }
      return [c.key, { sum: sum.toString(), missing }];
    }),
  );

  return (
    <>
      <PageHeader
        title="Реестр работ"
        subtitle={
          <>
            {data.asOf && <>Состояние на {data.asOf} · </>}
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
        rows={filtered.slice((page - 1) * pageSize, page * pageSize)}
        total={filtered.length}
        allCount={data.rows.length}
        page={page}
        pageSize={pageSize}
        totals={totals}
        sort={sort}
        initialFilters={filters}
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
