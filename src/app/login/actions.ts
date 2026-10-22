"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { createSession, destroySession, verifyPassword } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import type { ActionState } from "@/components/forms";

// Простейшая защита от перебора паролей (в пределах процесса).
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: "Введите e-mail и пароль" };
  const { email, password } = parsed.data;

  const a = attempts.get(email);
  if (a && a.count >= MAX_ATTEMPTS && a.until > Date.now()) {
    return { ok: false, error: "Слишком много попыток. Повторите через несколько минут." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid || !user.isActive) {
    const cur = attempts.get(email);
    attempts.set(email, { count: (cur && cur.until > Date.now() ? cur.count : 0) + 1, until: Date.now() + LOCK_MS });
    return { ok: false, error: user && valid && !user.isActive ? "Доступ отозван. Обратитесь к администратору." : "Неверный e-mail или пароль" };
  }
  attempts.delete(email);
  await createSession(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logAudit({ userId: user.id, action: "auth.login", entityType: "User", entityId: user.id });
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
