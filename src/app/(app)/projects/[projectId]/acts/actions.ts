"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ActStatus } from "@prisma/client";
import { assertProjectPermission } from "@/lib/server/auth";
import { runAction, UserError, type ActionState } from "@/lib/server/action";
import * as acts from "@/lib/server/services/act";
import * as rec from "@/lib/server/services/recognition";

const reval = (projectId: string) => revalidatePath(`/projects/${projectId}`, "layout");

function payload(fd: FormData): { header: Record<string, unknown>; lines: unknown[] } {
  try {
    const p = JSON.parse(String(fd.get("payload") ?? "{}"));
    return { header: p.header ?? {}, lines: Array.isArray(p.lines) ? p.lines : [] };
  } catch {
    throw new UserError("Некорректные данные формы");
  }
}

export async function createActAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    const p = payload(fd);
    id = await acts.createAct(a.user.id, projectId, p.header, p.lines, { duplicateDecision: (fd.get("duplicateDecision") as string | null) || null });
  });
  if (res?.ok) redirect(`/projects/${projectId}/acts/${id}`);
  return res;
}

export async function updateActAction(projectId: string, actId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    const p = payload(fd);
    await acts.updateAct(a.user.id, projectId, actId, p.header, p.lines);
    reval(projectId);
    return "Акт сохранён";
  });
}

export async function changeActStatusAction(projectId: string, actId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const to = String(fd.get("status")) as ActStatus;
    if (!Object.values(ActStatus).includes(to)) throw new UserError("Неизвестный статус");
    const a = await assertProjectPermission(projectId, to === "SIGNED" ? "act.sign" : "act.edit");
    const override = fd.get("override") === "on";
    await acts.changeActStatus(a.user.id, projectId, actId, to, {
      comment: (fd.get("comment") as string | null)?.trim() || null,
      signedAt: (fd.get("signedAt") as string | null) || null,
      override,
      canOverride: a.can("act.override"),
    });
    reval(projectId);
    return "Статус акта изменён";
  });
}

export async function createCorrectionAction(projectId: string, actId: string, _prev: ActionState): Promise<ActionState> {
  let id = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    id = await acts.createCorrection(a.user.id, projectId, actId);
  });
  if (res?.ok) redirect(`/projects/${projectId}/acts/${id}`);
  return res;
}

export async function duplicateDecisionAction(projectId: string, actId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    await acts.setDuplicateDecision(a.user.id, projectId, actId, (fd.get("comment") as string | null) ?? null);
    reval(projectId);
  });
}

// ───────────── Распознавание ─────────────

export async function startRecognitionAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    id = await rec.startRecognition(a.user.id, projectId, fd.getAll("files") as File[]);
  });
  if (res?.ok) redirect(`/projects/${projectId}/acts/recognition/${id}`);
  return res;
}

export async function addPagesAction(projectId: string, id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    await rec.addRecognitionPages(a.user.id, projectId, id, fd.getAll("files") as File[]);
    if (fd.get("rerun") === "on") await rec.retryRecognition(a.user.id, projectId, id);
    reval(projectId);
    return fd.get("rerun") === "on" ? "Страницы добавлены, распознавание запущено заново" : "Страницы добавлены. Запустите повторное распознавание, чтобы учесть их.";
  });
}

export async function retryRecognitionAction(projectId: string, id: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    await rec.retryRecognition(a.user.id, projectId, id);
    reval(projectId);
    return "Распознавание запущено";
  });
}

export async function manualEntryAction(projectId: string, id: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    await rec.startManualEntry(a.user.id, projectId, id);
    reval(projectId);
  });
}

export async function cancelRecognitionAction(projectId: string, id: string, _prev: ActionState): Promise<ActionState> {
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    await rec.cancelRecognition(a.user.id, projectId, id, null);
  });
  if (res?.ok) redirect(`/projects/${projectId}/acts`);
  return res;
}

export async function saveDraftAction(projectId: string, id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    let data: unknown;
    try {
      data = JSON.parse(String(fd.get("draft") ?? "null"));
    } catch {
      throw new UserError("Некорректные данные черновика");
    }
    const n = await rec.saveDraft(a.user.id, projectId, id, data);
    reval(projectId);
    return n ? `Сохранено изменений: ${n}. Проверки пересчитаны.` : "Сохранено. Проверки пересчитаны.";
  });
}

export async function confirmRecognitionAction(projectId: string, id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let actId = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "act.edit");
    const status = fd.get("status") === "ON_APPROVAL" ? "ON_APPROVAL" : "DRAFT";
    actId = await rec.confirmRecognition(a.user.id, projectId, id, status);
    reval(projectId);
  });
  if (res?.ok) redirect(`/projects/${projectId}/acts/${actId}?confirmed=1`);
  return res;
}
