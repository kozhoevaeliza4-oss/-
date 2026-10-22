"use client";

import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Opt = { id: string; name: string };

export function ProgressForm({
  action,
  measurementType,
  unit,
  plannedQuantity,
  current,
  canConfirmOverrun,
  today,
}: {
  action: A;
  measurementType: "QUANTITY" | "PERCENT";
  unit: string | null;
  plannedQuantity: string | null;
  current: string | null;
  canConfirmOverrun: boolean;
  today: string;
}) {
  return (
    <ActionForm action={action} resetOnSuccess>
      <div className="grid grid-cols-2 gap-3">
        {measurementType === "QUANTITY" ? (
          <label>
            <span className="label">Фактический объём накопленным итогом{unit ? `, ${unit}` : ""} *</span>
            <input name="quantity" inputMode="decimal" required className="input" placeholder={current ?? ""} />
            <span className="mt-1 block text-xs text-slate-500">План: {plannedQuantity ?? "нет данных"}. Текущее значение: {current ?? "нет"}.</span>
          </label>
        ) : (
          <label>
            <span className="label">Подтверждённый процент готовности *</span>
            <input name="percent" inputMode="decimal" required className="input" placeholder={current ?? ""} />
            <span className="mt-1 block text-xs text-slate-500">Текущее значение: {current ? `${current} %` : "нет"}.</span>
          </label>
        )}
        <label>
          <span className="label">Дата, на которую зафиксировано *</span>
          <input name="asOfDate" type="date" required defaultValue={today} max={today} className="input" />
        </label>
      </div>
      <label className="block">
        <span className="label">Комментарий / основание *</span>
        <textarea name="comment" rows={2} required className="input" placeholder="Например: исполнительная съёмка от 20.10, акт освидетельствования скрытых работ № 15" />
      </label>
      <label className="block">
        <span className="label">Подтверждающий документ или фото (PDF, JPG, PNG, XLSX, DOCX)</span>
        <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx" className="block w-full text-sm" />
      </label>
      {canConfirmOverrun && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="overrunConfirmed" className="mt-0.5" />
          <span>Превышение планового объёма подтверждено (доп. объёмы / изменение проекта). Отмечайте только при наличии основания.</span>
        </label>
      )}
      <SubmitButton>Сохранить выполнение</SubmitButton>
    </ActionForm>
  );
}

export function ItemEditForm({
  action,
  objects,
  stages,
  values,
}: {
  action: A;
  objects: Opt[];
  stages: Opt[];
  values: {
    objectId: string | null;
    stageId: string | null;
    measurementType: string;
    plannedStartDate: string;
    plannedEndDate: string;
    actualEndDate: string;
    comment: string | null;
    forecastRemainingCost: string | null;
    forecastNote: string | null;
  };
}) {
  return (
    <ActionForm action={action}>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">Корпус</span>
          <select name="objectId" defaultValue={values.objectId ?? ""} className="input">
            <option value="">—</option>
            {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Этап</span>
          <select name="stageId" defaultValue={values.stageId ?? ""} className="input">
            <option value="">—</option>
            {stages.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Способ учёта выполнения</span>
          <select name="measurementType" defaultValue={values.measurementType} className="input">
            <option value="QUANTITY">Объёмом (количество)</option>
            <option value="PERCENT">Процентом готовности</option>
          </select>
        </label>
        <div />
        <label>
          <span className="label">Плановое начало</span>
          <input type="date" name="plannedStartDate" defaultValue={values.plannedStartDate} className="input" />
        </label>
        <label>
          <span className="label">Плановое завершение</span>
          <input type="date" name="plannedEndDate" defaultValue={values.plannedEndDate} className="input" />
        </label>
        <label>
          <span className="label">Фактическое завершение</span>
          <input type="date" name="actualEndDate" defaultValue={values.actualEndDate} className="input" />
        </label>
        <label>
          <span className="label">Прогноз затрат на остаток работ</span>
          <input name="forecastRemainingCost" inputMode="decimal" defaultValue={values.forecastRemainingCost ?? ""} className="input" />
        </label>
      </div>
      <label className="block">
        <span className="label">Основание прогноза</span>
        <input name="forecastNote" defaultValue={values.forecastNote ?? ""} className="input" />
      </label>
      <label className="block">
        <span className="label">Комментарий</span>
        <textarea name="comment" rows={2} defaultValue={values.comment ?? ""} className="input" />
      </label>
      <p className="text-xs text-slate-500">При смене способа учёта история сохраняется; новое значение нужно внести в новом формате.</p>
      <SubmitButton>Сохранить</SubmitButton>
    </ActionForm>
  );
}

export function ManualItemForm({ action, objects, stages }: { action: A; objects: Opt[]; stages: Opt[] }) {
  return (
    <ActionForm action={action}>
      <div className="grid grid-cols-3 gap-3">
        <label>
          <span className="label">Код</span>
          <input name="code" className="input" />
        </label>
        <label className="col-span-2">
          <span className="label">Наименование работы *</span>
          <input name="name" required className="input" />
        </label>
        <label>
          <span className="label">Ед. изм.</span>
          <input name="unit" className="input" />
        </label>
        <label>
          <span className="label">Корпус</span>
          <select name="objectId" className="input">
            <option value="">—</option>
            {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Этап</span>
          <select name="stageId" className="input">
            <option value="">—</option>
            {stages.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Способ учёта выполнения</span>
          <select name="measurementType" className="input">
            <option value="QUANTITY">Объёмом</option>
            <option value="PERCENT">Процентом готовности</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Основание добавления *</span>
        <textarea name="comment" required rows={2} className="input" placeholder="Например: дополнительные работы по письму заказчика № … от …" />
      </label>
      <p className="text-xs text-slate-500">
        Статья, добавленная вручную, не имеет плановой стоимости и не входит в общий объём сметы, пока не появится в утверждённой версии сметы.
      </p>
      <SubmitButton>Добавить статью</SubmitButton>
    </ActionForm>
  );
}
