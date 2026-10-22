"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertProjectPermission } from "@/lib/server/auth";
import { runAction, type ActionState } from "@/lib/server/action";
import * as svc from "@/lib/server/services/progressImport";
import { cancelImportJob } from "@/lib/server/services/estimate";

export async function uploadProgressAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "progress.update");
    id = await svc.startProgressImport(a.user.id, projectId, fd.get("file") as File | null);
  });
  if (res?.ok) redirect(`/projects/${projectId}/progress-import/${id}`);
  return res;
}

export async function confirmProgressAction(projectId: string, jobId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "progress.update");
    const n = await svc.confirmProgressImport(a.user.id, projectId, jobId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return `Обновлено статей: ${n}. Показатели пересчитаны.`;
  });
}

export async function cancelProgressAction(projectId: string, jobId: string, _prev: ActionState): Promise<ActionState> {
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "progress.update");
    await cancelImportJob(a.user.id, projectId, jobId);
  });
  if (res?.ok) redirect(`/projects/${projectId}/progress-import`);
  return res;
}
