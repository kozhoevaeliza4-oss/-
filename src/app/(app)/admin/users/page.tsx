import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { CreateUserForm, InlineButton, ResetPasswordForm } from "../AdminForms";
import { createUserAction, setActiveAction, setAdminAction, resetPasswordAction } from "../actions";

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { memberships: { include: { project: { select: { code: true } }, role: { select: { name: true } } } } },
  });
  return (
    <>
      <PageHeader title="Пользователи" subtitle="Создание учётных записей и отзыв доступа. Доступ к проектам выдаётся на странице «Участники» каждого проекта." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Все пользователи" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead><tr><th>Пользователь</th><th>Статус</th><th>Проекты и роли</th><th>Последний вход</th><th>Действия</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}<div className="text-xs text-slate-500">{u.email}</div></td>
                    <td className="space-y-1">
                      {u.isActive ? <Badge tone="green">Активен</Badge> : <Badge tone="red">Доступ отозван</Badge>}
                      {u.isAdmin && <div><Badge tone="blue">Администратор</Badge></div>}
                    </td>
                    <td className="text-xs">{u.memberships.map((m) => `${m.project.code}: ${m.role.name}`).join("; ") || "—"}</td>
                    <td className="text-xs">{fmtDateTime(u.lastLoginAt)}</td>
                    <td>
                      {u.id !== me.id && (
                        <div className="flex flex-wrap gap-1">
                          {u.isActive ? (
                            <InlineButton action={setActiveAction.bind(null, u.id, false)} label="Отозвать доступ" confirm={`Отозвать доступ у ${u.name}? Все его сессии будут завершены.`} />
                          ) : (
                            <InlineButton action={setActiveAction.bind(null, u.id, true)} label="Восстановить" />
                          )}
                          <InlineButton action={setAdminAction.bind(null, u.id, !u.isAdmin)} label={u.isAdmin ? "Снять админа" : "Сделать админом"} confirm="Изменить права администратора?" />
                          <ResetPasswordForm action={resetPasswordAction.bind(null, u.id)} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Новый пользователь"><CreateUserForm action={createUserAction} /></Card>
      </div>
    </>
  );
}
