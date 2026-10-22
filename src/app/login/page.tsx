import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Реестр строительных работ</h1>
        <p className="mb-5 text-sm text-slate-500">Контроль себестоимости и договорного покрытия</p>
        <LoginForm />
      </div>
    </main>
  );
}
