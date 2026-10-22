"use client";

import { ActionForm, SubmitButton, type ActionState } from "./forms";

/** Кнопка, выполняющая серверное действие (с подтверждением и сообщением о результате). */
export function ActionButton({
  action,
  label,
  confirm,
  className = "btn-secondary btn-sm",
  pendingText = "…",
}: {
  action: (prev: ActionState) => Promise<ActionState>;
  label: string;
  confirm?: string;
  className?: string;
  pendingText?: string;
}) {
  return (
    <ActionForm action={action} confirm={confirm} className="inline-flex flex-col gap-1">
      <SubmitButton className={className} pendingText={pendingText}>{label}</SubmitButton>
    </ActionForm>
  );
}
