"use client";

/** Граница ошибок: пользователь видит понятное сообщение, а не пустую страницу; подробности — в журнале сервера. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Не удалось открыть страницу</h1>
      <p className="mt-2 text-sm text-slate-600">Произошла ошибка на сервере. Введённые ранее данные не изменены. Повторите попытку; если ошибка повторяется, сообщите администратору код ошибки.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-500">Код: {error.digest}</p>}
      <button type="button" className="btn-primary mt-6" onClick={reset}>Повторить</button>
    </main>
  );
}
