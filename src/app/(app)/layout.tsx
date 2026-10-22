import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-12 max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link href="/" className="text-sm font-semibold text-slate-900">
              Реестр строительных работ
            </Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900">Проекты</Link>
              {user.isAdmin && (
                <>
                  <Link href="/admin/users" className="hover:text-slate-900">Пользователи</Link>
                  <Link href="/admin/roles" className="hover:text-slate-900">Роли</Link>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {/* На телефоне имя не помещается рядом с меню — показывается с ширины sm */}
            <span className="hidden text-slate-600 sm:inline">
              {user.name}
              {user.isAdmin && <span className="ml-1 text-xs text-slate-400">(администратор)</span>}
            </span>
            <form action={logoutAction}>
              <button className="btn-secondary btn-sm">Выйти</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-5">{children}</main>
    </div>
  );
}
