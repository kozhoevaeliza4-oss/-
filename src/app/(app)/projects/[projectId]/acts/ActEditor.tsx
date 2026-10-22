"use client";

import { startTransition, useActionState, useState } from "react";
import type { ActionState } from "@/components/forms";
import { ItemPicker } from "@/components/ItemPicker";
import { fmtMoney } from "@/lib/format";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export interface EditorLine {
  key: string;
  lineNo: string;
  code: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  note: string;
  allocations: { workItemId: string; label: string; quantity: string; amount: string }[];
}

export interface EditorHeader {
  number: string;
  date: string;
  periodFrom: string;
  periodTo: string;
  contractId: string;
  contractorId: string;
  currency: string;
  objectText: string;
  documentTotal: string;
  vatAmount: string;
  comment: string;
}

let seq = 0;
const newLine = (): EditorLine => ({ key: `n${Date.now()}${seq++}`, lineNo: "", code: "", description: "", unit: "", quantity: "", unitPrice: "", amount: "", note: "", allocations: [] });

export function ActEditor({
  action,
  projectId,
  header: h0,
  lines: l0,
  contracts,
  contractors,
  submitLabel,
}: {
  action: A;
  projectId: string;
  header: EditorHeader;
  lines: EditorLine[];
  contracts: { id: string; label: string; contractorId: string | null }[];
  contractors: { id: string; name: string }[];
  submitLabel: string;
}) {
  const [h, setH] = useState(h0);
  // Ключ первой пустой строки детерминирован: он попадает в разметку и должен совпасть при гидратации
  const [lines, setLines] = useState<EditorLine[]>(l0.length ? l0 : [{ ...newLine(), key: "initial" }]);
  const [state, formAction, pending] = useActionState(action, null);
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\s/g, "").replace(",", ".")));
  const total = lines.reduce((s, l) => s + (num(l.amount) ?? 0), 0);
  const set = (k: keyof EditorHeader) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setH({ ...h, [k]: e.target.value });
  const upd = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append(
      "payload",
      JSON.stringify({
        header: { ...h, contractId: h.contractId || null, contractorId: h.contractorId || null },
        lines: lines.map((l) => ({
          lineNo: l.lineNo,
          code: l.code,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          amount: l.amount,
          note: l.note,
          allocations: l.allocations.map((a) => ({ workItemId: a.workItemId, quantity: a.quantity, amount: a.amount })),
        })),
      }),
    );
    startTransition(() => formAction(fd));
  };

  return (
    <form onSubmit={submit} method="post" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <label><span className="label">Номер акта *</span><input className="input" value={h.number} onChange={set("number")} required /></label>
        <label><span className="label">Дата *</span><input className="input" type="date" value={h.date} onChange={set("date")} required /></label>
        <label><span className="label">Период с</span><input className="input" type="date" value={h.periodFrom} onChange={set("periodFrom")} /></label>
        <label><span className="label">по</span><input className="input" type="date" value={h.periodTo} onChange={set("periodTo")} /></label>
        <label className="sm:col-span-2">
          <span className="label">Договор</span>
          <select className="input" value={h.contractId} onChange={(e) => { const c = contracts.find((x) => x.id === e.target.value); setH({ ...h, contractId: e.target.value, contractorId: c?.contractorId ?? h.contractorId }); }}>
            <option value="">— без договора —</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Подрядчик</span>
          <select className="input" value={h.contractorId} onChange={set("contractorId")}>
            <option value="">—</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label><span className="label">Валюта</span><input className="input uppercase" maxLength={3} value={h.currency} onChange={set("currency")} /></label>
        <label className="sm:col-span-2"><span className="label">Объект / корпус</span><input className="input" value={h.objectText} onChange={set("objectText")} /></label>
        <label><span className="label">Итог по документу</span><input className="input" inputMode="decimal" value={h.documentTotal} onChange={set("documentTotal")} /></label>
        <label><span className="label">НДС по документу</span><input className="input" inputMode="decimal" value={h.vatAmount} onChange={set("vatAmount")} /></label>
        <label className="sm:col-span-4"><span className="label">Комментарий</span><input className="input" value={h.comment} onChange={set("comment")} /></label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Позиции ({lines.length}) · сумма строк {fmtMoney(total, h.currency || "KGS")}</h3>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, newLine()])}>+ Строка</button>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => {
            const q = num(l.quantity);
            const p = num(l.unitPrice);
            const a = num(l.amount);
            const mismatch = q !== null && p !== null && a !== null && Math.abs(q * p - a) > 1;
            return (
              <div key={l.key} className={`rounded border p-2 ${mismatch ? "border-red-400" : "border-slate-200"}`}>
                <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
                  <label className="col-span-1"><span className="text-[10px] text-slate-500">№</span><input className="input px-1 py-1 text-xs" value={l.lineNo} onChange={(e) => upd(i, { lineNo: e.target.value })} /></label>
                  <label className="col-span-2"><span className="text-[10px] text-slate-500">Шифр</span><input className="input px-1 py-1 text-xs" value={l.code} onChange={(e) => upd(i, { code: e.target.value })} /></label>
                  <label className="col-span-3 sm:col-span-4"><span className="text-[10px] text-slate-500">Наименование *</span><input className="input px-1 py-1 text-xs" value={l.description} onChange={(e) => upd(i, { description: e.target.value })} required /></label>
                  <label className="col-span-1"><span className="text-[10px] text-slate-500">Ед.</span><input className="input px-1 py-1 text-xs" value={l.unit} onChange={(e) => upd(i, { unit: e.target.value })} /></label>
                  <label className="col-span-2 sm:col-span-1"><span className="text-[10px] text-slate-500">Кол-во</span><input className="input px-1 py-1 text-right text-xs" inputMode="decimal" value={l.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} /></label>
                  <label className="col-span-2 sm:col-span-1"><span className="text-[10px] text-slate-500">Цена</span><input className="input px-1 py-1 text-right text-xs" inputMode="decimal" value={l.unitPrice} onChange={(e) => upd(i, { unitPrice: e.target.value })} /></label>
                  <label className="col-span-2"><span className="text-[10px] text-slate-500">Сумма *</span><input className="input px-1 py-1 text-right text-xs" inputMode="decimal" value={l.amount} onChange={(e) => upd(i, { amount: e.target.value })} required placeholder={q !== null && p !== null ? (q * p).toFixed(2) : ""} /></label>
                </div>
                {mismatch && <p className="mt-1 text-xs text-red-700">Количество × цена = {(q! * p!).toFixed(2)} ≠ сумме строки</p>}
                <div className="mt-2 rounded bg-slate-50 p-2 text-xs">
                  {l.allocations.map((al, k) => (
                    <div key={al.workItemId} className="mb-1 flex flex-wrap items-center gap-1">
                      <span className="flex-1 truncate">{al.label}</span>
                      <input className="input w-20 px-1 py-0.5 text-right text-xs" placeholder="объём" value={al.quantity} onChange={(e) => upd(i, { allocations: l.allocations.map((x, j) => (j === k ? { ...x, quantity: e.target.value } : x)) })} />
                      <input className="input w-28 px-1 py-0.5 text-right text-xs" placeholder="сумма" value={al.amount} onChange={(e) => upd(i, { allocations: l.allocations.map((x, j) => (j === k ? { ...x, amount: e.target.value } : x)) })} />
                      <button type="button" className="text-red-700" onClick={() => upd(i, { allocations: l.allocations.filter((_, j) => j !== k) })}>✕</button>
                    </div>
                  ))}
                  <ItemPicker
                    projectId={projectId}
                    name={`pick-${l.key}`}
                    onChange={(it) => {
                      if (!it || l.allocations.some((x) => x.workItemId === it.id)) return;
                      upd(i, { allocations: [...l.allocations, { workItemId: it.id, label: it.label, quantity: l.allocations.length ? "" : l.quantity, amount: l.allocations.length ? "" : l.amount }] });
                    }}
                  />
                  {!l.allocations.length && <p className="mt-1 text-purple-700">Нет сопоставления со статьёй — строка не войдёт в «принято по АВР» статей</p>}
                </div>
                <div className="mt-1 text-right">
                  <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} disabled={lines.length === 1}>Удалить строку</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {state && !state.ok && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald-700">{state.message}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Сохранение…" : submitLabel}</button>
    </form>
  );
}
