import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { PageHeader } from "@/components/ui";
import { ContractForm } from "../ContractForms";
import { createContractAction } from "../actions";

export default async function NewContractPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId, "contract.edit");
  const [project, contractors] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.contractor.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Новый договор" subtitle="Ручной ввод реквизитов. Файл можно загрузить на странице «Договоры»." />
      <div className="card p-4">
        <ContractForm action={createContractAction.bind(null, projectId)} contractors={contractors} defaultCurrency={project.currency} />
      </div>
    </div>
  );
}
