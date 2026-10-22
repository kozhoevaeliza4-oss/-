"use client";

import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function ObjectForm({ action, values }: { action: A; values?: { code: string; name: string; sortOrder: number } }) {
  return (
    <ActionForm action={action} resetOnSuccess={!values} className="flex flex-wrap items-end gap-2">
      <label className="w-28">
        <span className="label">Код *</span>
        <input name="code" required defaultValue={values?.code} className="input" />
      </label>
      <label className="min-w-[200px] flex-1">
        <span className="label">Название *</span>
        <input name="name" required defaultValue={values?.name} className="input" />
      </label>
      <label className="w-24">
        <span className="label">Порядок</span>
        <input name="sortOrder" type="number" defaultValue={values?.sortOrder ?? 0} className="input" />
      </label>
      <SubmitButton className="btn-primary">{values ? "Сохранить" : "Добавить"}</SubmitButton>
    </ActionForm>
  );
}

export function StageForm({
  action,
  objects,
  values,
}: {
  action: A;
  objects: { id: string; name: string }[];
  values?: { code: string; name: string; objectId: string | null; sortOrder: number; plannedStart: string; plannedEnd: string };
}) {
  return (
    <ActionForm action={action} resetOnSuccess={!values} className="flex flex-wrap items-end gap-2">
      <label className="w-28">
        <span className="label">Код *</span>
        <input name="code" required defaultValue={values?.code} className="input" />
      </label>
      <label className="min-w-[200px] flex-1">
        <span className="label">Название *</span>
        <input name="name" required defaultValue={values?.name} className="input" />
      </label>
      <label className="w-48">
        <span className="label">Корпус</span>
        <select name="objectId" defaultValue={values?.objectId ?? ""} className="input">
          <option value="">Весь проект</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </label>
      <label className="w-36">
        <span className="label">План. начало</span>
        <input name="plannedStart" type="date" defaultValue={values?.plannedStart} className="input" />
      </label>
      <label className="w-36">
        <span className="label">План. окончание</span>
        <input name="plannedEnd" type="date" defaultValue={values?.plannedEnd} className="input" />
      </label>
      <label className="w-20">
        <span className="label">Порядок</span>
        <input name="sortOrder" type="number" defaultValue={values?.sortOrder ?? 0} className="input" />
      </label>
      <SubmitButton className="btn-primary">{values ? "Сохранить" : "Добавить"}</SubmitButton>
    </ActionForm>
  );
}

export function DeleteButton({ action, confirm }: { action: (prev: ActionState) => Promise<ActionState>; confirm: string }) {
  return (
    <ActionForm action={action} confirm={confirm} className="inline">
      <SubmitButton className="btn-secondary btn-sm" pendingText="…">Удалить</SubmitButton>
    </ActionForm>
  );
}

export function FinanceSettingsForm({
  action,
  values,
}: {
  action: A;
  values: { costMethodologyConfirmed: boolean; costMethodologyNote: string | null; forecastModelConfirmed: boolean };
}) {
  return (
    <ActionForm action={action}>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="costMethodologyConfirmed" defaultChecked={values.costMethodologyConfirmed} className="mt-0.5" />
        <span>
          Методика определения фактической себестоимости по данным 1С согласована с бухгалтерией.
          <span className="block text-xs text-slate-500">
            Пока не отмечено, суммы 1С показываются как «Импортированные затраты по 1С», а отклонения — как предварительные.
          </span>
        </span>
      </label>
      <label className="block">
        <span className="label">Описание методики (счета, виды операций, исключения, кем и когда согласовано)</span>
        <textarea name="costMethodologyNote" rows={3} defaultValue={values.costMethodologyNote ?? ""} className="input" />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="forecastModelConfirmed" defaultChecked={values.forecastModelConfirmed} className="mt-0.5" />
        <span>
          Модель прогноза «фактические затраты + прогноз затрат на остаток работ» подтверждена.
          <span className="block text-xs text-slate-500">Без подтверждения прогноз итоговой стоимости не рассчитывается.</span>
        </span>
      </label>
      <SubmitButton>Сохранить</SubmitButton>
    </ActionForm>
  );
}
