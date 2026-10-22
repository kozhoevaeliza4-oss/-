import "server-only";
import { z } from "zod";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";
import { hashPassword } from "../auth";
import { parse } from "./project";
import { ALL_PERMISSIONS } from "@/lib/permissions";

const passwordSchema = z.string().min(10, "Пароль не короче 10 символов").max(200);

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email("Некорректный e-mail"),
  name: z.string().trim().min(1, "Укажите имя").max(200),
  password: passwordSchema,
  isAdmin: z.boolean(),
});

export async function createUser(actorId: string, input: z.input<typeof userCreateSchema>) {
  const data = parse(userCreateSchema, input);
  if (await prisma.user.findUnique({ where: { email: data.email } })) throw new UserError("Пользователь с таким e-mail уже есть");
  const u = await prisma.user.create({
    data: { email: data.email, name: data.name, isAdmin: data.isAdmin, passwordHash: await hashPassword(data.password) },
  });
  await logAudit({ userId: actorId, action: "user.create", entityType: "User", entityId: u.id, after: { email: u.email, name: u.name, isAdmin: u.isAdmin } });
  return u.id;
}

export async function setUserActive(actorId: string, userId: string, isActive: boolean) {
  if (actorId === userId && !isActive) throw new UserError("Нельзя отозвать доступ у самого себя");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isActive } }),
    // Отзыв доступа немедленно завершает все сессии
    ...(isActive ? [] : [prisma.session.deleteMany({ where: { userId } })]),
  ]);
  await logAudit({ userId: actorId, action: isActive ? "user.activate" : "user.revoke", entityType: "User", entityId: userId, before: { isActive: u.isActive }, after: { isActive } });
}

export async function setUserAdmin(actorId: string, userId: string, isAdmin: boolean) {
  if (actorId === userId && !isAdmin) throw new UserError("Нельзя снять права администратора с самого себя");
  await prisma.user.update({ where: { id: userId }, data: { isAdmin } });
  await logAudit({ userId: actorId, action: "user.setAdmin", entityType: "User", entityId: userId, after: { isAdmin } });
}

export async function resetPassword(actorId: string, userId: string, password: string) {
  const p = parse(passwordSchema, password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(p) } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  await logAudit({ userId: actorId, action: "user.resetPassword", entityType: "User", entityId: userId });
}

// ───── Роли

export async function updateRole(actorId: string, roleId: string, input: { name: string; description: string | null; permissions: string[] }) {
  const name = input.name.trim();
  if (!name) throw new UserError("Укажите название роли");
  const permissions = input.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
  if (permissions.length && !permissions.includes("project.view")) permissions.unshift("project.view");
  const before = await prisma.role.findUniqueOrThrow({ where: { id: roleId } });
  await prisma.role.update({ where: { id: roleId }, data: { name, description: input.description, permissions } });
  await logAudit({ userId: actorId, action: "role.update", entityType: "Role", entityId: roleId, before: { name: before.name, permissions: before.permissions }, after: { name, permissions } });
}

export async function createRole(actorId: string, input: { code: string; name: string }) {
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,40}$/.test(code)) throw new UserError("Код роли: латиница, цифры и «_», 2–40 символов");
  if (!input.name.trim()) throw new UserError("Укажите название роли");
  if (await prisma.role.findUnique({ where: { code } })) throw new UserError("Роль с таким кодом уже есть");
  const r = await prisma.role.create({ data: { code, name: input.name.trim(), permissions: ["project.view"] } });
  await logAudit({ userId: actorId, action: "role.create", entityType: "Role", entityId: r.id, after: { code, name: r.name } });
  return r.id;
}

// ───── Участники проекта

/** Запрет повышения привилегий: нельзя выдать роль с правами, которых нет у самого назначающего. */
async function assertCanGrant(roleId: string, actorPermissions: Set<string> | null) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw new UserError("Роль не найдена");
  if (actorPermissions && role.permissions.some((p) => !actorPermissions.has(p)))
    throw new UserError("Нельзя назначить роль с правами, превышающими ваши собственные");
}

export async function addMember(actorId: string, projectId: string, email: string, roleId: string, actorPermissions: Set<string> | null) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new UserError("Пользователь не найден. Сначала его должен создать администратор.");
  await assertCanGrant(roleId, actorPermissions);
  const exists = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  if (exists) throw new UserError("Пользователь уже участник проекта — измените его роль в списке");
  await prisma.projectMember.create({ data: { projectId, userId: user.id, roleId } });
  await logAudit({ userId: actorId, projectId, action: "member.add", entityType: "ProjectMember", entityId: user.id, after: { email: user.email, roleId } });
}

export async function changeMemberRole(actorId: string, projectId: string, memberId: string, roleId: string, actorPermissions: Set<string> | null) {
  const m = await prisma.projectMember.findFirstOrThrow({ where: { id: memberId, projectId } });
  if (m.userId === actorId) throw new UserError("Нельзя изменить собственную роль");
  await assertCanGrant(roleId, actorPermissions);
  await assertCanGrant(m.roleId, actorPermissions);
  await prisma.projectMember.update({ where: { id: memberId }, data: { roleId } });
  await logAudit({ userId: actorId, projectId, action: "member.update", entityType: "ProjectMember", entityId: m.userId, before: { roleId: m.roleId }, after: { roleId } });
}

export async function removeMember(actorId: string, projectId: string, memberId: string, actorPermissions: Set<string> | null) {
  const m = await prisma.projectMember.findFirstOrThrow({ where: { id: memberId, projectId } });
  if (m.userId === actorId) throw new UserError("Нельзя удалить из проекта самого себя");
  await assertCanGrant(m.roleId, actorPermissions);
  await prisma.projectMember.delete({ where: { id: memberId } });
  await logAudit({ userId: actorId, projectId, action: "member.remove", entityType: "ProjectMember", entityId: m.userId, before: { roleId: m.roleId } });
}
