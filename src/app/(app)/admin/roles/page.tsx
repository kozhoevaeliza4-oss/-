import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { Card, PageHeader } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { CreateRoleForm, RoleForm } from "../AdminForms";
import { createRoleAction, updateRoleAction } from "../actions";

export default async function RolesPage() {
  await requireAdmin();
  const roles = await prisma.role.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { members: true } } } });
  const perms = Object.entries(PERMISSIONS) as [string, string][];
  return (
    <>
      <PageHeader title="Роли и права" subtitle="Права ролей настраиваются. Изменения действуют сразу для всех участников с этой ролью." />
      <div className="space-y-4">
        {roles.map((r) => (
          <Card key={r.id} title={`${r.name} (${r._count.members} назначений)`}>
            <RoleForm action={updateRoleAction.bind(null, r.id)} role={r} permissions={perms} />
          </Card>
        ))}
        <Card title="Новая роль"><CreateRoleForm action={createRoleAction} /></Card>
      </div>
    </>
  );
}
