"use client";

import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function UploadEstimateForm({ action, maxMb }: { action: A; maxMb: number }) {
  return (
    <ActionForm action={action}>
      <label className="block">
        <span className="label">Файл сметы (XLSX, CSV; до {maxMb} МБ) *</span>
        <input type="file" name="file" required accept=".xlsx,.xlsm,.csv" className="block w-full text-sm" />
      </label>
      <label className="block">
        <span className="label">Название версии *</span>
        <input name="name" required placeholder="Например: ЛСР 02-01-01, ред. от 15.10.2026" className="input" />
      </label>
      <label className="block">
        <span className="label">Примечание</span>
        <textarea name="notes" rows={2} className="input" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="allowDuplicate" /> Загрузить повторно, даже если этот файл уже загружался
      </label>
      <p className="text-xs text-slate-500">
        После загрузки откроется предпросмотр: проверьте сопоставление столбцов и ошибки. Данные не записываются в реестр до утверждения версии.
      </p>
      <SubmitButton pendingText="Загрузка и разбор…">Загрузить и проверить</SubmitButton>
    </ActionForm>
  );
}

export function SimpleActionButton({
  action,
  label,
  className = "btn-primary",
  confirm,
  pendingText,
}: {
  action: (prev: ActionState) => Promise<ActionState>;
  label: string;
  className?: string;
  confirm?: string;
  pendingText?: string;
}) {
  return (
    <ActionForm action={action} confirm={confirm} className="inline-flex flex-col gap-1">
      <SubmitButton className={className} pendingText={pendingText}>{label}</SubmitButton>
    </ActionForm>
  );
}

export function ApproveForm({ approve, reject, hasActive }: { approve: A; reject: A; hasActive: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ActionForm
        action={approve}
        confirm={hasActive ? "Утвердить версию? Текущая утверждённая версия будет сохранена в истории, реестр пересчитается." : "Утвердить версию как первоначальную смету проекта?"}
      >
        <label className="block">
          <span className="label">Комментарий к утверждению</span>
          <input name="comment" className="input" placeholder="Основание: письмо заказчика, протокол и т.п." />
        </label>
        <SubmitButton pendingText="Утверждение…">Утвердить версию</SubmitButton>
      </ActionForm>
      <ActionForm action={reject} confirm="Отклонить версию? Данные останутся в истории, но не будут применены.">
        <label className="block">
          <span className="label">Причина отклонения *</span>
          <input name="reason" className="input" />
        </label>
        <SubmitButton className="btn-secondary" pendingText="…">Отклонить</SubmitButton>
      </ActionForm>
    </div>
  );
}
