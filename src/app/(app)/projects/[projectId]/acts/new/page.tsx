import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { ActEditor } from "../ActEditor";
import { createActAction } from "../actions";

export default async function NewActPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId, "act.edit");
  const [project, contracts, contractors] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.contract.findMany({ where: { projectId, status: { not: "TERMINATED" } }, include: { contractor: true }, orderBy: { date: "desc" } }),
    prisma.contractor.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Новый АВР (ручной ввод)" subtitle="Акт создаётся в статусе «черновик». Подписание отмечается отдельно с указанием даты." />
      <div className="card p-4">
        <ActEditor
          action={createActAction.bind(null, projectId)}
          projectId={projectId}
          header={{ number: "", date: new Date().toISOString().slice(0, 10), periodFrom: "", periodTo: "", contractId: "", contractorId: "", currency: project.currency, objectText: "", documentTotal: "", vatAmount: "", comment: "" }}
          lines={[]}
          contracts={contracts.map((c) => ({ id: c.id, label: `№ ${c.number ?? "—"}${c.date ? ` от ${fmtDate(c.date)}` : ""} · ${c.contractor?.name ?? ""}`, contractorId: c.contractorId }))}
          contractors={contractors}
          submitLabel="Создать акт"
        />
      </div>
    </div>
  );
}
