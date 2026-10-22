import { requireAdmin } from "@/lib/server/auth";
import { PageHeader } from "@/components/ui";
import { ProjectForm } from "../ProjectForm";
import { createProjectAction } from "../actions";

export default async function NewProjectPage() {
  await requireAdmin();
  return (
    <div className="max-w-xl">
      <PageHeader title="Новый проект" subtitle="После создания добавьте корпуса, этапы и загрузите смету" />
      <div className="card p-4">
        <ProjectForm action={createProjectAction} />
      </div>
    </div>
  );
}
