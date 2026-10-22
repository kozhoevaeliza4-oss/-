import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { ALL_PERMISSIONS, Permission } from "@/lib/permissions";

export const SESSION_COOKIE = "cr_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 часов

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // В продакшене cookie передаётся только по HTTPS; COOKIE_SECURE=false — для локальной сети без TLS (не рекомендуется)
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export type CurrentUser = { id: string; email: string; name: string; isAdmin: boolean };

/** Текущий пользователь (кэшируется в пределах запроса). Неактивные пользователи и истёкшие сессии отклоняются. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, isAdmin: true, isActive: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
  const { isActive: _ignored, ...user } = session.user;
  void _ignored;
  return user;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/forbidden");
  return user;
}

export class AccessDeniedError extends Error {
  constructor(message = "Недостаточно прав") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export interface ProjectAccess {
  user: CurrentUser;
  projectId: string;
  roleName: string;
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
}

/** Права пользователя в проекте. Системный администратор имеет все права. null — доступа нет. */
export const getProjectAccess = cache(async (projectId: string): Promise<ProjectAccess | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  let roleName: string;
  let permissions: Set<Permission>;
  if (user.isAdmin) {
    const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!exists) return null;
    roleName = "Системный администратор";
    permissions = new Set(ALL_PERMISSIONS);
  } else {
    const m = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
      include: { role: true },
    });
    if (!m) return null;
    roleName = m.role.name;
    permissions = new Set(m.role.permissions.filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p)));
  }
  return { user, projectId, roleName, permissions, can: (p) => permissions.has(p) };
});

/** Для страниц: нет доступа к проекту — 404 (не раскрываем существование проекта). */
export async function requireProjectAccess(projectId: string, permission: Permission = "project.view"): Promise<ProjectAccess> {
  await requireUser();
  const access = await getProjectAccess(projectId);
  if (!access || !access.can("project.view")) notFound();
  if (!access.can(permission)) redirect("/forbidden");
  return access;
}

/** Для серверных действий: бросает AccessDeniedError. */
export async function assertProjectPermission(projectId: string, permission: Permission): Promise<ProjectAccess> {
  const user = await getCurrentUser();
  if (!user) throw new AccessDeniedError("Сессия истекла или выполнен выход. Войдите снова в соседней вкладке — введённые данные останутся в форме.");
  const access = await getProjectAccess(projectId);
  if (!access || !access.can("project.view") || !access.can(permission)) throw new AccessDeniedError();
  return access;
}
