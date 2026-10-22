import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export default async function ProjectsPage() {
  const user = await requireUser();
  // Пользователь видит только проекты, в которых он участник (администратор — все).
  const projects = await prisma.project.findMany({
    where: user.isAdmin ? {} : { members: { some: { userId: user.id } } },
    include: {
      _count: { select: { workItems: true, contracts: true } },
      members: { where: { userId: user.id }, include: { role: true } },
    },
    orderBy: [{ isArchived: "asc" }, { createdAt: "desc" }],
  });

  return (
    <>
      <PageHeader
        title="Проекты"
        subtitle="Доступные вам строительные проекты"
        actions={user.isAdmin && <Link href="/projects/new" className="btn-primary">Создать проект</Link>}
      />
      {projects.length === 0 ? (
        <EmptyState>
          {user.isAdmin ? "Проектов пока нет. Создайте первый проект." : "У вас нет доступа ни к одному проекту. Обратитесь к администратору."}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Код</th>
                <th>Проект</th>
                <th>Валюта</th>
                <th className="text-right">Статей</th>
                <th className="text-right">Договоров</th>
                <th>Ваша роль</th>
                <th>Создан</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="font-mono text-xs">{p.code}</td>
                  <td>
                    <Link href={`/projects/${p.id}`} className="link font-medium">{p.name}</Link>{" "}
                    {p.isDemo && <Badge tone="yellow">Демо-данные</Badge>}{" "}
                    {p.isArchived && <Badge tone="grey">Архив</Badge>}
                  </td>
                  <td>{p.currency}</td>
                  <td className="num">{p._count.workItems}</td>
                  <td className="num">{p._count.contracts}</td>
                  <td>{p.members[0]?.role.name ?? (user.isAdmin ? "Администратор" : "—")}</td>
                  <td>{fmtDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
