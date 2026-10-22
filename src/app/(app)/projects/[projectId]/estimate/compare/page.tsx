import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { compareVersions } from "@/lib/server/services/estimate";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DiffSummary, DiffTable } from "../DiffTable";

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ a?: string; b?: string; all?: string }>;
}) {
  const { projectId } = await params;
  const { a, b, all } = await searchParams;
  await requireProjectAccess(projectId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const [va, vb] = await Promise.all([
    a ? prisma.estimateVersion.findFirst({ where: { id: a, projectId } }) : null,
    b ? prisma.estimateVersion.findFirst({ where: { id: b, projectId } }) : null,
  ]);
  if (!va || !vb) return <EmptyState>Выберите две версии для сравнения на странице «Смета».</EmptyState>;
  const diff = await compareVersions(va.id, vb.id);
  const q = `?a=${va.id}&b=${vb.id}`;
  return (
    <>
      <PageHeader
        title="Сравнение версий сметы"
        subtitle={<>v{va.versionNumber} «{va.name}» → v{vb.versionNumber} «{vb.name}»</>}
        actions={<Link href={`/projects/${projectId}/estimate`} className="btn-secondary">К списку версий</Link>}
      />
      <Card
        title="Изменения"
        actions={
          <Link className="link text-xs" href={`/projects/${projectId}/estimate/compare${q}${all ? "" : "&all=1"}`}>
            {all ? "Скрыть строки без изменений" : "Показать все строки"}
          </Link>
        }
      >
        <div className="mb-3"><DiffSummary diff={diff} currency={project.currency} /></div>
        <DiffTable diff={diff} currency={project.currency} showUnchanged={!!all} />
      </Card>
    </>
  );
}
