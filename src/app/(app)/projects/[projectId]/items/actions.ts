"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertProjectPermission } from "@/lib/server/auth";
import { runAction, formToObject, type ActionState } from "@/lib/server/action";
import * as svc from "@/lib/server/services/workItem";

export async function createManualItemAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "workitem.edit");
    id = await svc.createManualWorkItem(a.user.id, projectId, formToObject(fd));
  });
  if (res?.ok) redirect(`/projects/${projectId}/items/${id}`);
  return res;
}

export async function updateItemAction(projectId: string, itemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "workitem.edit");
    await svc.updateWorkItem(a.user.id, projectId, itemId, formToObject(fd));
    revalidatePath(`/projects/${projectId}`, "layout");
  });
}

export async function recordProgressAction(projectId: string, itemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "progress.update");
    const o = formToObject(fd);
    const res = await svc.recordProgress(
      a.user.id,
      projectId,
      itemId,
      { asOfDate: o.asOfDate, quantity: o.quantity, percent: o.percent, comment: o.comment, overrunConfirmed: o.overrunConfirmed === "on" },
      { canConfirmOverrun: a.can("progress.confirmOverrun"), file: fd.get("file") as File | null },
    );
    revalidatePath(`/projects/${projectId}`, "layout");
    return res.exceedsUnconfirmed
      ? "Сохранено. Факт превышает плановый объём — превышение не подтверждено и показывается отдельно."
      : "Выполнение обновлено, показатели пересчитаны";
  });
}
