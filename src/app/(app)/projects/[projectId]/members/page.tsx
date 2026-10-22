import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { Card, PageHeader } from "@/components/ui";
import { AddMemberForm, InlineButton, MemberRoleForm } from "@/app/(app)/admin/AdminForms";
import { addMemberAction, changeMemberRoleAction, removeMemberAction } from "@/app/(app)/admin/actions";

export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId, "project.members");
  const [members, allRoles] = await Promise.all([
    prisma.projectMember.findMany({ where: { projectId }, include: { user: true, role: true }, orderBy: { createdAt: "asc" } }),
    prisma.role.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  // Назначать можно только роли, права которых не превышают собственные
  const roles = access.user.isAdmin ? allRoles : allRoles.filter((r) => r.permissions.every((p) => access.permissions.has(p as never)));
  return (
    <>
      <PageHeader title="Участники проекта" subtitle="Доступ выдаётся отдельно на каждый проект. Системные администраторы видят все проекты." />
      <Card title="Участники" className="mb-4">
        <table className="table-base text-sm">
          <thead><tr><th>Пользователь</th><th>Роль</th><th>Статус учётной записи</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.user.name}<div className="text-xs text-slate-500">{m.user.email}</div></td>
                <td>{m.userId === access.user.id ? m.role.name : <MemberRoleForm action={changeMemberRoleAction.bind(null, projectId, m.id)} roles={roles} roleId={m.roleId} />}</td>
                <td>{m.user.isActive ? "Активна" : "Доступ отозван"}</td>
                <td>{m.userId !== access.user.id && <InlineButton action={removeMemberAction.bind(null, projectId, m.id)} label="Удалить из проекта" confirm={`Удалить ${m.user.name} из проекта?`} />}</td>
              </tr>
            ))}
            {members.length === 0 && <tr><td colSpan={4} className="text-slate-500">Участников нет.</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card title="Добавить участника"><AddMemberForm action={addMemberAction.bind(null, projectId)} roles={roles} /></Card>
    </>
  );
}
