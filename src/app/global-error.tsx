"use client";

/** Ошибка в корневом макете: отдельный документ без зависимостей от остального интерфейса. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Приложение временно недоступно</h1>
        <p style={{ color: "#475569", fontSize: "0.875rem" }}>Повторите попытку позже.{error.digest ? ` Код: ${error.digest}` : ""}</p>
        <button type="button" onClick={reset} style={{ marginTop: "1.5rem", padding: "0.5rem 1rem" }}>Повторить</button>
      </body>
    </html>
  );
}
