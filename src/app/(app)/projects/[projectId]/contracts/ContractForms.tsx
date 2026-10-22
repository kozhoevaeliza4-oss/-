"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { ItemPicker } from "@/components/ItemPicker";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function UploadContractForm({ action, maxMb }: { action: A; maxMb: number }) {
  return (
    <ActionForm action={action}>
      <label className="block">
        <span className="label">Договор, доп. соглашение или скан (PDF, DOCX, XLSX, JPG, PNG, HEIC; до {maxMb} МБ)</span>
        <input type="file" name="file" required accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.heic" className="block w-full text-sm" />
      </label>
      <p className="text-xs text-slate-500">
        Текст извлекается на сервере (сканы — локальным OCR). Найденные реквизиты подставятся с указанием страницы и фрагмента и будут иметь статус «требует проверки». Договор не считается действующим, пока его не подтвердит уполномоченный сотрудник.
      </p>
      <SubmitButton pendingText="Загрузка и извлечение…">Загрузить договор</SubmitButton>
    </ActionForm>
  );
}

export type ContractValues = {
  contractorId: string | null;
  contractorInn: string | null;
  number: string | null;
  date: string;
  subject: string | null;
  objectText: string | null;
  totalAmount: string | null;
  currency: string | null;
  startDate: string;
  endDate: string;
  paymentTerms: string | null;
  signingStatus: string;
  comment: string | null;
};

export function ContractForm({
  action,
  values,
  contractors,
  pendingFields = [],
  defaultCurrency,
}: {
  action: A;
  values?: ContractValues;
  contractors: { id: string; name: string; inn: string | null }[];
  pendingFields?: string[];
  defaultCurrency: string;
}) {
  const [newContractor, setNewContractor] = useState(!values?.contractorId && contractors.length === 0);
  const mark = (f: string) => (pendingFields.includes(f) ? "ring-2 ring-amber-400" : "");
  const hint = (f: string) => (pendingFields.includes(f) ? <span className="ml-1 text-[10px] font-semibold text-amber-700">распознано — проверить</span> : null);
  return (
    <ActionForm action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <span className="label">Подрядчик {hint("contractorName")}</span>
          {!newContractor ? (
            <div className="flex gap-2">
              <select name="contractorId" defaultValue={values?.contractorId ?? ""} className={`input ${mark("contractorName")}`}>
                <option value="">— не выбран —</option>
                {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}{c.inn ? ` (ИНН ${c.inn})` : ""}</option>)}
              </select>
              <button type="button" className="btn-secondary btn-sm whitespace-nowrap" onClick={() => setNewContractor(true)}>Новый</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input name="newContractorName" placeholder="Наименование подрядчика" className={`input ${mark("contractorName")}`} />
              {contractors.length > 0 && <button type="button" className="btn-secondary btn-sm" onClick={() => setNewContractor(false)}>Из списка</button>}
            </div>
          )}
        </div>
        <label><span className="label">ИНН подрядчика {hint("contractorInn")}</span><input name="contractorInn" defaultValue={values?.contractorInn ?? ""} inputMode="numeric" className={`input ${mark("contractorInn")}`} /></label>
        <label><span className="label">Номер договора {hint("number")}</span><input name="number" defaultValue={values?.number ?? ""} className={`input ${mark("number")}`} /></label>
        <label><span className="label">Дата договора {hint("date")}</span><input type="date" name="date" defaultValue={values?.date ?? ""} className={`input ${mark("date")}`} /></label>
        <label>
          <span className="label">Статус подписания</span>
          <select name="signingStatus" defaultValue={values?.signingStatus ?? "UNKNOWN"} className="input">
            <option value="UNKNOWN">Не установлен</option>
            <option value="NOT_SIGNED">Не подписан</option>
            <option value="PARTIALLY_SIGNED">Подписан одной стороной</option>
            <option value="SIGNED">Подписан сторонами</option>
          </select>
        </label>
        <label className="sm:col-span-2"><span className="label">Предмет договора {hint("subject")}</span><textarea name="subject" rows={2} defaultValue={values?.subject ?? ""} className={`input ${mark("subject")}`} /></label>
        <label className="sm:col-span-2"><span className="label">Объект {hint("objectText")}</span><input name="objectText" defaultValue={values?.objectText ?? ""} className={`input ${mark("objectText")}`} /></label>
        <label><span className="label">Сумма договора (исходная) {hint("totalAmount")}</span><input name="totalAmount" inputMode="decimal" defaultValue={values?.totalAmount ?? ""} className={`input ${mark("totalAmount")}`} /></label>
        <label><span className="label">Валюта {hint("currency")}</span><input name="currency" defaultValue={values?.currency ?? defaultCurrency} maxLength={3} className={`input uppercase ${mark("currency")}`} /></label>
        <label><span className="label">Начало работ {hint("startDate")}</span><input type="date" name="startDate" defaultValue={values?.startDate ?? ""} className={`input ${mark("startDate")}`} /></label>
        <label><span className="label">Окончание работ {hint("endDate")}</span><input type="date" name="endDate" defaultValue={values?.endDate ?? ""} className={`input ${mark("endDate")}`} /></label>
        <label className="sm:col-span-2"><span className="label">Условия оплаты {hint("paymentTerms")}</span><textarea name="paymentTerms" rows={2} defaultValue={values?.paymentTerms ?? ""} className={`input ${mark("paymentTerms")}`} /></label>
        <label className="sm:col-span-2"><span className="label">Комментарий</span><textarea name="comment" rows={2} defaultValue={values?.comment ?? ""} className="input" /></label>
      </div>
      <SubmitButton>Сохранить реквизиты</SubmitButton>
    </ActionForm>
  );
}

export function StatusForm({ action, current, canVerify }: { action: A; current: string; canVerify: boolean }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="label">Статус действительности</span>
          <select name="status" defaultValue={current} className="input">
            <option value="UPLOADED_NEEDS_REVIEW">Загружен, требуется проверка</option>
            {canVerify && <option value="ACTIVE">Подписан и действует</option>}
            {canVerify && <option value="COMPLETED">Завершён</option>}
            <option value="NEEDS_CLARIFICATION">Требует уточнения</option>
            <option value="TERMINATED">Расторгнут</option>
          </select>
        </label>
        <label className="min-w-[220px] flex-1">
          <span className="label">Основание / комментарий</span>
          <input name="comment" className="input" />
        </label>
        <SubmitButton className="btn-secondary">Изменить статус</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AmendmentForm({ action, canSign }: { action: A; canSign: boolean }) {
  return (
    <ActionForm action={action} resetOnSuccess>
      <div className="grid gap-2 sm:grid-cols-3">
        <label><span className="label">Номер</span><input name="number" className="input" /></label>
        <label><span className="label">Дата</span><input type="date" name="date" className="input" /></label>
        <label><span className="label">Изменение суммы (±)</span><input name="amountDelta" inputMode="decimal" className="input" placeholder="например, 250000 или -100000" /></label>
        <label className="sm:col-span-2"><span className="label">Содержание</span><input name="description" className="input" /></label>
        <label><span className="label">Новый срок окончания</span><input type="date" name="newEndDate" className="input" /></label>
        <label className="sm:col-span-3"><span className="label">Файл (необязательно)</span><input type="file" name="file" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png" className="block w-full text-sm" /></label>
      </div>
      {canSign && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isSigned" /> Подписано сторонами (изменение суммы войдёт в текущую сумму договора)</label>}
      <SubmitButton>Добавить доп. соглашение</SubmitButton>
    </ActionForm>
  );
}

export function AllocationForm({ action, projectId }: { action: A; projectId: string }) {
  return (
    <ActionForm action={action} resetOnSuccess>
      <div className="grid gap-2 sm:grid-cols-6">
        <div className="sm:col-span-3"><span className="label">Статья сметы *</span><ItemPicker projectId={projectId} required /></div>
        <label><span className="label">Объём по договору</span><input name="quantity" inputMode="decimal" className="input" /></label>
        <label><span className="label">Цена</span><input name="unitPrice" inputMode="decimal" className="input" /></label>
        <label><span className="label">Сумма</span><input name="amount" inputMode="decimal" className="input" placeholder="= объём × цена" /></label>
      </div>
      <p className="text-xs text-slate-500">Сумма распределений не может превышать текущую сумму договора без оформленного исключения. Новое распределение требует подтверждения.</p>
      <SubmitButton>Добавить / обновить распределение</SubmitButton>
    </ActionForm>
  );
}

export function OverAllocationForm({ action, allowed, comment }: { action: A; allowed: boolean; comment: string | null }) {
  return (
    <ActionForm action={action}>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="allowed" defaultChecked={allowed} className="mt-0.5" />
        <span>Разрешить распределение сверх суммы договора (исключение)</span>
      </label>
      <input name="comment" defaultValue={comment ?? ""} placeholder="Обоснование (обязательно)" className="input" />
      <SubmitButton className="btn-secondary">Сохранить</SubmitButton>
    </ActionForm>
  );
}
