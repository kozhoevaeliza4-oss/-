import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-lg font-semibold">Недостаточно прав</h1>
      <p className="mt-2 text-sm text-slate-600">У вашей роли нет доступа к этому разделу. Если доступ нужен для работы, обратитесь к руководителю проекта или администратору.</p>
      <Link href="/" className="btn-secondary mt-4">К списку проектов</Link>
    </div>
  );
}
