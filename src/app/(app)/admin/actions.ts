"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, assertProjectPermission } from "@/lib/server/auth";
import { runAction, type ActionState } from "@/lib/server/action";
import * as svc from "@/lib/server/services/users";

export async function createUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await requireAdmin();
    await svc.createUser(a.id, {
      email: String(fd.get("email") ?? ""),
      name: String(fd.get("name") ?? ""),
      password: String(fd.get("password") ?? ""),
      isAdmin: fd.get("isAdmin") === "on",
    });
    revalidatePath("/admin/users");
    return "Пользователь создан";
  });
}

export async function setActiveAction(userId: string, isActive: boolean, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await requireAdmin();
    await svc.setUserActive(a.id, userId, isActive);
    revalidatePath("/admin/users");
    return isActive ? "Доступ восстановлен" : "Доступ отозван, сессии завершены";
  });
}

export async function setAdminAction(userId: string, isAdmin: boolean, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await requireAdmin();
    await svc.setUserAdmin(a.id, userId, isAdmin);
    revalidatePath("/admin/users");
  });
}

export async function resetPasswordAction(userId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await requireAdmin();
    await svc.resetPassword(a.id, userId, String(fd.get("password") ?? ""));
    return "Пароль изменён, сессии пользователя завершены";
  });
}

export async function updateRoleAction(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await requireAdmin();
    await svc.updateRole(a.id, roleId, {
      name: String(fd.get("name") ?? ""),
      description: (fd.get("description") as string | null)?.trim() || null,
      permissions: fd.getAll("permissions").map(String),
    });
    revalidatePath("/admin/roles");
  });
}

export async function createRoleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await requireAdmin();
    await svc.createRole(a.id, { code: String(fd.get("code") ?? ""), name: String(fd.get("name") ?? "") });
    revalidatePath("/admin/roles");
    return "Роль создана — настройте её права";
  });
}

async function grantContext(projectId: string) {
  const a = await assertProjectPermission(projectId, "project.members");
  return { a, perms: a.user.isAdmin ? null : (a.permissions as Set<string>) };
}

export async function addMemberAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { a, perms } = await grantContext(projectId);
    await svc.addMember(a.user.id, projectId, String(fd.get("email") ?? ""), String(fd.get("roleId") ?? ""), perms);
    revalidatePath(`/projects/${projectId}/members`);
    return "Участник добавлен";
  });
}

export async function changeMemberRoleAction(projectId: string, memberId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { a, perms } = await grantContext(projectId);
    await svc.changeMemberRole(a.user.id, projectId, memberId, String(fd.get("roleId") ?? ""), perms);
    revalidatePath(`/projects/${projectId}/members`);
  });
}

export async function removeMemberAction(projectId: string, memberId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const { a, perms } = await grantContext(projectId);
    await svc.removeMember(a.user.id, projectId, memberId, perms);
    revalidatePath(`/projects/${projectId}/members`);
    return "Участник удалён";
  });
}
