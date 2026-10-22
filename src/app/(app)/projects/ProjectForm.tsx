"use client";

import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

type Values = { code?: string; name?: string; description?: string | null; address?: string | null; currency?: string };

export function ProjectForm({
  action,
  values,
  currencyLocked = false,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  values?: Values;
  currencyLocked?: boolean;
}) {
  return (
    <ActionForm action={action}>
      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="label">Код проекта *</span>
          <input name="code" required defaultValue={values?.code} className="input" />
        </label>
        <label className="col-span-2 block">
          <span className="label">Название *</span>
          <input name="name" required defaultValue={values?.name} className="input" />
        </label>
      </div>
      <label className="block">
        <span className="label">Адрес</span>
        <input name="address" defaultValue={values?.address ?? ""} className="input" />
      </label>
      <label className="block">
        <span className="label">Описание</span>
        <textarea name="description" rows={3} defaultValue={values?.description ?? ""} className="input" />
      </label>
      {!currencyLocked && (
        <label className="block w-40">
          <span className="label">Базовая валюта *</span>
          <select name="currency" defaultValue={values?.currency ?? "KGS"} className="input">
            <option value="KGS">KGS — сом</option>
            <option value="USD">USD — доллар США</option>
            <option value="EUR">EUR — евро</option>
            <option value="RUB">RUB — рубль</option>
            <option value="KZT">KZT — тенге</option>
          </select>
          <span className="mt-1 block text-xs text-slate-500">Суммы в других валютах не смешиваются с базовой без утверждённого курса.</span>
        </label>
      )}
      <SubmitButton>Сохранить</SubmitButton>
    </ActionForm>
  );
}
