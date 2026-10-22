import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { PageHeader } from "@/components/ui";
import { ManualItemForm } from "../ItemForms";
import { createManualItemAction } from "../actions";

export default async function NewItemPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId, "workitem.edit");
  const [objects, stages] = await Promise.all([
    prisma.constructionObject.findMany({ where: { projectId }, orderBy: { code: "asc" } }),
    prisma.constructionStage.findMany({ where: { projectId }, orderBy: { code: "asc" } }),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Новая статья работ" subtitle="Добавление статьи, отсутствующей в смете" />
      <div className="card p-4">
        <ManualItemForm
          action={createManualItemAction.bind(null, projectId)}
          objects={objects.map((o) => ({ id: o.id, name: `${o.code} — ${o.name}` }))}
          stages={stages.map((s) => ({ id: s.id, name: `${s.code} — ${s.name}` }))}
        />
      </div>
    </div>
  );
}
