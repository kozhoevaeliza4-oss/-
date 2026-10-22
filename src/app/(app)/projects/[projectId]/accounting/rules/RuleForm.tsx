"use client";

import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { ItemPicker } from "@/components/ItemPicker";

export function RuleForm({ action, projectId, contracts, categories }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; projectId: string; contracts: { id: string; label: string }[]; categories: [string, string][] }) {
  return (
    <ActionForm action={action} resetOnSuccess>
      <label className="block"><span className="label">Название *</span><input name="name" required className="input" /></label>
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Счёт Дт начинается с</span><input name="account" className="input" placeholder="1636" /></label>
        <label><span className="label">Счёт Кт начинается с</span><input name="corrAccount" className="input" /></label>
      </div>
      <label className="block"><span className="label">Текст аналитики/содержания содержит</span><input name="textContains" className="input" /></label>
      <label className="block"><span className="label">Контрагент содержит</span><input name="counterpartyContains" className="input" /></label>
      <label className="block"><span className="label">Категория *</span><select name="category" className="input">{categories.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <div><span className="label">Статья сметы (необязательно)</span><ItemPicker projectId={projectId} /></div>
      <label className="block"><span className="label">Договор (необязательно)</span><select name="contractId" className="input"><option value="">—</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label className="block"><span className="label">Приоритет (меньше — раньше)</span><input name="priority" type="number" defaultValue={100} className="input" /></label>
      <SubmitButton>Добавить правило</SubmitButton>
    </ActionForm>
  );
}
