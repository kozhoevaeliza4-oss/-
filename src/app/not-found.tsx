import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Страница не найдена</h1>
      <p className="mt-2 text-sm text-slate-600">Запись удалена, ссылка устарела или у вас нет доступа к этому проекту.</p>
      <Link href="/" className="btn-primary mt-6 inline-block">К списку проектов</Link>
    </main>
  );
}
