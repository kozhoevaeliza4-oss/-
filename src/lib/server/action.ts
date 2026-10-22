import "server-only";
import { AccessDeniedError } from "./auth";

export type ActionState = { ok: boolean; message?: string; error?: string; fieldErrors?: Record<string, string> } | null;

/** Пользовательская ошибка, текст которой можно показать в интерфейсе. */
export class UserError extends Error {
  constructor(message: string, public fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "UserError";
  }
}

/** Обёртка серверного действия: перехватывает ожидаемые ошибки и возвращает их в форму. */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? "Сохранено" };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
    // redirect()/notFound() из next/navigation должны пробрасываться дальше
    if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_")) throw e;
    console.error("Action failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Не удалось выполнить операцию. Подробности записаны в журнал сервера." };
  }
}

/** FormData → объект строк (пустые поля → undefined). */
export function formToObject(fd: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    out[k] = v === "" ? undefined : v;
  }
  return out;
}
