"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertProjectPermission } from "@/lib/server/auth";
import { runAction, formToObject, type ActionState } from "@/lib/server/action";
import * as svc from "@/lib/server/services/estimate";

export async function uploadEstimateAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let jobId = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "estimate.import");
    jobId = await svc.startEstimateImport(a.user.id, projectId, {
      file: fd.get("file") as File | null,
      name: String(fd.get("name") ?? ""),
      notes: (fd.get("notes") as string | null)?.trim() || null,
      allowDuplicate: fd.get("allowDuplicate") === "on",
    });
  });
  if (res?.ok) redirect(`/projects/${projectId}/estimate/import/${jobId}`);
  return res;
}

export async function updateMappingAction(projectId: string, jobId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "estimate.import");
    await svc.updateEstimateMapping(a.user.id, projectId, jobId, formToObject(fd));
    revalidatePath(`/projects/${projectId}/estimate/import/${jobId}`);
    return "Сопоставление применено — проверьте предпросмотр";
  });
}

export async function confirmImportAction(projectId: string, jobId: string, _prev: ActionState): Promise<ActionState> {
  let versionId = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "estimate.import");
    versionId = await svc.confirmEstimateImport(a.user.id, projectId, jobId);
  });
  if (res?.ok) redirect(`/projects/${projectId}/estimate/versions/${versionId}`);
  return res;
}

export async function cancelImportAction(projectId: string, jobId: string, _prev: ActionState): Promise<ActionState> {
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "estimate.import");
    await svc.cancelImportJob(a.user.id, projectId, jobId);
  });
  if (res?.ok) redirect(`/projects/${projectId}/estimate`);
  return res;
}

export async function approveVersionAction(projectId: string, versionId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "estimate.approve");
    await svc.approveVersion(a.user.id, projectId, versionId, (fd.get("comment") as string | null)?.trim() || null);
    revalidatePath(`/projects/${projectId}`, "layout");
  });
  if (res?.ok) redirect(`/projects/${projectId}/estimate/versions/${versionId}?done=approved`);
  return res;
}

export async function rejectVersionAction(projectId: string, versionId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "estimate.approve");
    await svc.rejectVersion(a.user.id, projectId, versionId, (fd.get("reason") as string | null) ?? null);
    revalidatePath(`/projects/${projectId}`, "layout");
  });
  if (res?.ok) redirect(`/projects/${projectId}/estimate/versions/${versionId}?done=rejected`);
  return res;
}
