"use client";

import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function AccountingUpload({ action, maxMb }: { action: A; maxMb: number }) {
  return (
    <ActionForm action={action}>
      <label className="block">
        <span className="label">Выгрузка (XLSX, CSV; до {maxMb} МБ)</span>
        <input type="file" name="file" required accept=".xlsx,.xlsm,.csv,.txt" className="block w-full text-sm" />
      </label>
      <p className="text-xs text-slate-500">Например, карточка или анализ счёта 1636/1637, сохранённые из 1С в Excel. Файл сохраняется с контрольной суммой; после предпросмотра нужно подтвердить импорт.</p>
      <SubmitButton pendingText="Загрузка…">Загрузить и проверить</SubmitButton>
    </ActionForm>
  );
}
