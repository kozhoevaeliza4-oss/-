"use client";

import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

export function UploadProgressForm({ action }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  return (
    <ActionForm action={action}>
      <label className="block">
        <span className="label">Заполненный шаблон (XLSX) *</span>
        <input type="file" name="file" accept=".xlsx" required className="block w-full text-sm" />
      </label>
      <SubmitButton pendingText="Проверка…">Загрузить и проверить</SubmitButton>
    </ActionForm>
  );
}
