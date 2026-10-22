"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const NEXT: Record<string, { value: string; label: string }[]> = {
  DRAFT: [{ value: "ON_APPROVAL", label: "Передать на согласование" }, { value: "SIGNED", label: "Отметить подписанным" }, { value: "ANNULLED", label: "Аннулировать" }],
  ON_APPROVAL: [{ value: "SIGNED", label: "Отметить подписанным" }, { value: "REJECTED", label: "Отклонить" }, { value: "DRAFT", label: "Вернуть в черновик" }, { value: "ANNULLED", label: "Аннулировать" }],
  REJECTED: [{ value: "DRAFT", label: "Вернуть в черновик" }, { value: "ANNULLED", label: "Аннулировать" }],
  SIGNED: [{ value: "ANNULLED", label: "Аннулировать" }],
};

export function ActStatusForm({ action, current, canSign, canOverride, hasViolations }: { action: A; current: string; canSign: boolean; canOverride: boolean; hasViolations: boolean }) {
  const options = (NEXT[current] ?? []).filter((o) => o.value !== "SIGNED" || canSign);
  const [to, setTo] = useState(options[0]?.value ?? "");
  if (!options.length) return <p className="text-sm text-slate-500">Нет доступных переходов.</p>;
  return (
    <ActionForm action={action}>
      <label className="block">
        <span className="label">Действие</span>
        <select name="status" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {to === "SIGNED" && (
        <>
          <label className="block">
            <span className="label">Дата подписания сторонами *</span>
            <input type="date" name="signedAt" required max={new Date().toISOString().slice(0, 10)} className="input" />
          </label>
          <p className="text-xs text-slate-500">Отметьте подписание только при наличии подписанного оригинала. Фотография документа не подтверждает подпись.</p>
          {hasViolations && canOverride && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="override" className="mt-0.5" />
              <span>Подписать с исключением по лимитам договора (обоснование обязательно)</span>
            </label>
          )}
          {hasViolations && !canOverride && <p className="text-xs text-red-700">Есть нарушения лимитов — подписание возможно только пользователем с правом исключений.</p>}
        </>
      )}
      <label className="block">
        <span className="label">{to === "REJECTED" || to === "ANNULLED" ? "Причина *" : "Комментарий / обоснование"}</span>
        <input name="comment" className="input" />
      </label>
      <SubmitButton>Применить</SubmitButton>
    </ActionForm>
  );
}

export function DuplicateDecisionForm({ action }: { action: A }) {
  return (
    <ActionForm action={action}>
      <input name="comment" className="input" placeholder="Это другой документ, потому что…" required />
      <SubmitButton className="btn-secondary">Подтвердить, что это другой документ</SubmitButton>
    </ActionForm>
  );
}
