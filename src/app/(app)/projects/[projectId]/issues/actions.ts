"use server";

import { revalidatePath } from "next/cache";
import { IssueStatus } from "@prisma/client";
import { assertProjectPermission } from "@/lib/server/auth";
import { runAction, type ActionState } from "@/lib/server/action";
import { syncIssues, updateIssue } from "@/lib/server/services/issues";

export async function syncIssuesAction(projectId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "issue.view");
    const r = await syncIssues(projectId, a.user.id);
    revalidatePath(`/projects/${projectId}`, "layout");
    return `Проверка выполнена: найдено ${r.detected}, новых ${r.created}, устранено ${r.resolved}, снова обнаружено ${r.reopened}`;
  });
}

export async function updateIssueAction(projectId: string, issueId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "issue.manage");
    const status = (fd.get("status") as string) || null;
    const assignee = fd.get("assigneeId");
    await updateIssue(a.user.id, projectId, issueId, {
      status: status as IssueStatus | null,
      assigneeId: assignee === null ? undefined : (assignee as string) || null,
      comment: (fd.get("comment") as string | null) ?? null,
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return "Сохранено";
  });
}
