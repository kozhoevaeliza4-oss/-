import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { NavTabs } from "@/components/NavTabs";
import { DemoBanner } from "@/components/ui";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const base = `/projects/${projectId}`;
  const tabs = [
    { href: base, label: "Панель", exact: true },
    { href: `${base}/registry`, label: "Реестр работ" },
    { href: `${base}/estimate`, label: "Смета" },
    { href: `${base}/structure`, label: "Структура и настройки" },
    ...(access.can("project.members") ? [{ href: `${base}/members`, label: "Участники" }] : []),
    ...(access.can("audit.view") ? [{ href: `${base}/audit`, label: "Журнал" }] : []),
  ];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-sm text-slate-500">
        <span className="font-mono text-xs">{project.code}</span>
        <span className="text-base font-semibold text-slate-900">{project.name}</span>
        <span>Валюта: {project.currency}</span>
        <span>Ваша роль: {access.roleName}</span>
      </div>
      <NavTabs tabs={tabs} />
      {project.isDemo && <DemoBanner />}
      {children}
    </div>
  );
}
