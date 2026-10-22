"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { TransactionCategory } from "@prisma/client";
import { assertProjectPermission } from "@/lib/server/auth";
import { runAction, formToObject, UserError, type ActionState } from "@/lib/server/action";
import * as svc from "@/lib/server/services/accounting";
import { cancelImportJob } from "@/lib/server/services/estimate";

const reval = (projectId: string) => revalidatePath(`/projects/${projectId}`, "layout");

export async function uploadAccountingAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "accounting.import");
    id = await svc.startAccountingImport(a.user.id, projectId, fd.get("file") as File | null);
  });
  if (res?.ok) redirect(`/projects/${projectId}/accounting/import/${id}`);
  return res;
}

export async function accountingMappingAction(projectId: string, jobId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "accounting.import");
    await svc.updateAccountingMapping(a.user.id, projectId, jobId, formToObject(fd));
    revalidatePath(`/projects/${projectId}/accounting/import/${jobId}`);
    return "Сопоставление применено";
  });
}

export async function confirmAccountingAction(projectId: string, jobId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "accounting.import");
    const s = await svc.confirmAccountingImport(a.user.id, projectId, jobId);
    reval(projectId);
    return `Импорт подтверждён: добавлено ${s.inserted}, пропущено как уже загруженные ${s.duplicates}, строк с ошибками ${s.errorRows.length}`;
  });
}

export async function cancelAccountingAction(projectId: string, jobId: string, _prev: ActionState): Promise<ActionState> {
  const res = await runAction(async () => {
    const a = await assertProjectPermission(projectId, "accounting.import");
    await cancelImportJob(a.user.id, projectId, jobId);
  });
  if (res?.ok) redirect(`/projects/${projectId}/accounting`);
  return res;
}

export async function classifyAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "accounting.classify");
    const ids = fd.getAll("ids").map(String);
    const mode = String(fd.get("mode") ?? "classify");
    if (!ids.length) throw new UserError("Выберите операции");
    if (mode === "confirm") {
      const n = await svc.confirmProposed(a.user.id, projectId, ids);
      reval(projectId);
      return `Подтверждено: ${n}`;
    }
    if (mode === "reset") {
      await svc.resetClassification(a.user.id, projectId, ids);
      reval(projectId);
      return "Классификация сброшена";
    }
    const category = String(fd.get("category") ?? "") as TransactionCategory;
    await svc.classifyTransactions(a.user.id, projectId, {
      ids,
      category: mode === "exclude" ? (category || "OTHER") as TransactionCategory : category,
      workItemId: (fd.get("workItemId") as string) || null,
      contractId: (fd.get("contractId") as string) || null,
      exclude: mode === "exclude",
      reason: (fd.get("reason") as string) || null,
    });
    reval(projectId);
    return `Обработано операций: ${ids.length}`;
  });
}

export async function splitAction(projectId: string, txId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "accounting.classify");
    const items = fd.getAll("partItem").map(String);
    const amounts = fd.getAll("partAmount").map(String);
    const parts = items.map((w, i) => ({ workItemId: w, amount: (amounts[i] ?? "").replace(/\s/g, "").replace(",", ".") })).filter((p) => p.workItemId && p.amount);
    await svc.splitTransaction(a.user.id, projectId, txId, parts);
    reval(projectId);
    return "Распределение сохранено";
  });
}

export async function createRuleAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "accounting.classify");
    await svc.createRule(a.user.id, projectId, formToObject(fd));
    reval(projectId);
    return "Правило добавлено";
  });
}

export async function ruleToggleAction(projectId: string, ruleId: string, active: boolean | "delete", _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "accounting.classify");
    await svc.toggleRule(a.user.id, projectId, ruleId, active);
    reval(projectId);
  });
}

export async function applyRulesAction(projectId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await assertProjectPermission(projectId, "accounting.classify");
    const n = await svc.applyRules(a.user.id, projectId);
    reval(projectId);
    return `Предложена классификация для ${n} операций — подтвердите её`;
  });
}
