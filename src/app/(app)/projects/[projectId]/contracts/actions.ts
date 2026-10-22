"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ContractStatus } from "@prisma/client";
import { assertProjectPermission } from "@/lib/server/auth";
import { runAction, formToObject, UserError, type ActionState } from "@/lib/server/action";
import * as svc from "@/lib/server/services/contract";

const reval = (projectId: string) => revalidatePath(`/projects/${projectId}`, "layout");

export async function uploadContractAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "contract.edit");
    const r = await svc.uploadContract(a.user.id, projectId, fd.get("file") as File | null);
    id = r.contractId;
  });
  if (res?.ok) redirect(`/projects/${projectId}/contracts/${id}?uploaded=1`);
  return res;
}

export async function createContractAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "contract.edit");
    id = await svc.createContract(a.user.id, projectId, formToObject(fd));
  });
  if (res?.ok) redirect(`/projects/${projectId}/contracts/${id}`);
  return res;
}

export async function updateContractAction(projectId: string, contractId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "contract.edit");
    await svc.updateContract(a.user.id, projectId, contractId, formToObject(fd));
    reval(projectId);
  });
}

export async function reviewFieldAction(projectId: string, contractId: string, fieldId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "contract.edit");
    await svc.reviewExtractedField(a.user.id, projectId, contractId, fieldId);
    reval(projectId);
    return "Отмечено как проверенное";
  });
}

export async function setStatusAction(projectId: string, contractId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const status = String(fd.get("status")) as ContractStatus;
    if (!Object.values(ContractStatus).includes(status)) throw new UserError("Неизвестный статус");
    const a = await assertProjectPermission(projectId, status === "ACTIVE" || status === "COMPLETED" ? "contract.verify" : "contract.edit");
    await svc.setContractStatus(a.user.id, projectId, contractId, status, (fd.get("comment") as string | null)?.trim() || null);
    reval(projectId);
    return "Статус договора изменён";
  });
}

export async function addAmendmentAction(projectId: string, contractId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "contract.edit");
    const o = formToObject(fd);
    const signed = fd.get("isSigned") === "on";
    if (signed && !a.can("contract.verify")) throw new UserError("Отметить доп. соглашение подписанным может только пользователь с правом подтверждения договоров");
    await svc.addAmendment(a.user.id, projectId, contractId, { number: o.number, date: o.date, description: o.description, amountDelta: o.amountDelta, newEndDate: o.newEndDate, isSigned: signed }, fd.get("file") as File | null);
    reval(projectId);
    return "Доп. соглашение добавлено";
  });
}

export async function signAmendmentAction(projectId: string, amendmentId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "contract.verify");
    await svc.signAmendment(a.user.id, projectId, amendmentId);
    reval(projectId);
  });
}

export async function upsertAllocationAction(projectId: string, contractId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "contract.edit");
    await svc.upsertAllocation(a.user.id, projectId, contractId, formToObject(fd));
    reval(projectId);
    return "Распределение сохранено — требуется подтверждение";
  });
}

export async function allocationStatusAction(projectId: string, allocationId: string, status: "CONFIRMED" | "REJECTED" | "DELETE", _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, status === "CONFIRMED" ? "contract.verify" : "contract.edit");
    await svc.setAllocationStatus(a.user.id, projectId, allocationId, status);
    reval(projectId);
  });
}

export async function overAllocationAction(projectId: string, contractId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "contract.verify");
    await svc.setOverAllocation(a.user.id, projectId, contractId, fd.get("allowed") === "on", (fd.get("comment") as string | null)?.trim() || null);
    reval(projectId);
  });
}
