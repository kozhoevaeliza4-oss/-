"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, assertProjectPermission } from "@/lib/server/auth";
import { runAction, formToObject, type ActionState } from "@/lib/server/action";
import * as svc from "@/lib/server/services/project";

export async function createProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction(async () => {
    const user = await requireAdmin();
    const p = await svc.createProject(user.id, formToObject(fd) as never);
    id = p.id;
  });
  if (res?.ok) redirect(`/projects/${id}/structure`);
  return res;
}

export async function updateProjectAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "project.manage");
    await svc.updateProject(a.user.id, projectId, formToObject(fd) as never);
    revalidatePath(`/projects/${projectId}`, "layout");
  });
}

export async function financeSettingsAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "finance.settings");
    await svc.updateFinanceSettings(a.user.id, projectId, {
      costMethodologyConfirmed: fd.get("costMethodologyConfirmed") === "on",
      costMethodologyNote: (fd.get("costMethodologyNote") as string | null)?.trim() || null,
      forecastModelConfirmed: fd.get("forecastModelConfirmed") === "on",
    });
    revalidatePath(`/projects/${projectId}`, "layout");
  });
}

export async function upsertObjectAction(projectId: string, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "project.manage");
    await svc.upsertObject(a.user.id, projectId, id, formToObject(fd) as never);
    revalidatePath(`/projects/${projectId}`, "layout");
  });
}

export async function deleteObjectAction(projectId: string, id: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "project.manage");
    await svc.deleteObject(a.user.id, projectId, id);
    revalidatePath(`/projects/${projectId}`, "layout");
    return "Удалено";
  });
}

export async function upsertStageAction(projectId: string, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "project.manage");
    await svc.upsertStage(a.user.id, projectId, id, formToObject(fd) as never);
    revalidatePath(`/projects/${projectId}`, "layout");
  });
}

export async function deleteStageAction(projectId: string, id: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "project.manage");
    await svc.deleteStage(a.user.id, projectId, id);
    revalidatePath(`/projects/${projectId}`, "layout");
    return "Удалено";
  });
}
