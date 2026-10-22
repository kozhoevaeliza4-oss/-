"use client";

import { useEffect, useState } from "react";
import { ActionForm, type ActionState } from "@/components/forms";
import { ItemPicker } from "@/components/ItemPicker";
import { Badge, type Tone } from "@/components/ui";
import { fmtDate, fmtMoney } from "@/lib/format";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export interface TxRow {
  id: string;
  date: string | null;
  documentNumber: string | null;
  account: string | null;
  corrAccount: string | null;
  amount: string | null;
  currency: string | null;
  counterparty: string | null;
  analytics: string;
  category: string;
  categoryLabel: string;
  classification: string;
  classificationLabel: string;
  classificationTone: Tone;
  allocations: string[];
  rule: string | null;
  possibleDuplicate: boolean;
  exclusionReason: string | null;
}

export function TransactionsTable({
  rows,
  action,
  projectId,
  categories,
  contracts,
  canClassify,
}: {
  rows: TxRow[];
  action: A;
  projectId: string;
  categories: [string, string][];
  contracts: { id: string; label: string }[];
  canClassify: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      {(state) => (
      <>
      <ClearOnSuccess state={state} onClear={() => setSelected(new Set())} />
      {canClassify && (
        <div className="card sticky top-0 z-20 space-y-2 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <span className="text-sm">Выбрано: <b>{selected.size}</b></span>
            <label><span className="label">Категория</span>
              <select name="category" className="input">{categories.filter(([k]) => k !== "UNCLASSIFIED").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <div className="min-w-[260px] flex-1"><span className="label">Статья сметы (для затрат)</span><ItemPicker projectId={projectId} /></div>
            <label><span className="label">Договор</span>
              <select name="contractId" className="input"><option value="">—</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button name="mode" value="classify" className="btn-primary btn-sm" disabled={!selected.size}>Подтвердить классификацию</button>
            <button name="mode" value="confirm" className="btn-secondary btn-sm" disabled={!selected.size}>Подтвердить предложенную правилом</button>
            <input name="reason" className="input w-56 py-1 text-xs" placeholder="Причина исключения" />
            <button name="mode" value="exclude" className="btn-secondary btn-sm" disabled={!selected.size}>Исключить из расчёта</button>
            <button name="mode" value="reset" className="btn-secondary btn-sm" disabled={!selected.size}>Сбросить</button>
          </div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="table-base text-xs">
          <thead>
            <tr>
              {canClassify && <th><input type="checkbox" aria-label="Выбрать все" checked={rows.length > 0 && selected.size === rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
              <th>Дата</th><th>Документ</th><th>Дт / Кт</th><th className="text-right">Сумма</th><th>Контрагент</th><th>Аналитика 1С</th><th>Категория</th><th>Статья / договор</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-blue-50" : "hover:bg-slate-50"}>
                {canClassify && <td><input type="checkbox" name="ids" value={r.id} checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label="Выбрать" /></td>}
                <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                <td>{r.documentNumber ?? "—"}{r.possibleDuplicate && <div><Badge tone="yellow">возможный дубль</Badge></div>}</td>
                <td className="whitespace-nowrap">{r.account ?? "—"} / {r.corrAccount ?? "—"}</td>
                <td className={`num ${r.amount && Number(r.amount) < 0 ? "text-red-700" : ""}`}>{fmtMoney(r.amount, r.currency ?? "KGS")}</td>
                <td>{r.counterparty ?? "—"}</td>
                <td className="max-w-[260px]">{r.analytics || <span className="text-red-700">нет аналитики</span>}</td>
                <td>
                  <Badge tone={r.classificationTone}>{r.classificationLabel}</Badge>
                  <div>{r.categoryLabel}{r.rule && <span className="text-slate-500"> · правило «{r.rule}»</span>}</div>
                  {r.exclusionReason && <div className="text-slate-500">{r.exclusionReason}</div>}
                </td>
                <td className="max-w-[240px]">{r.allocations.length ? r.allocations.map((a, i) => <div key={i}>{a}</div>) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      )}
    </ActionForm>
  );
}

function ClearOnSuccess({ state, onClear }: { state: ActionState; onClear: () => void }) {
  useEffect(() => {
    if (state?.ok) onClear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return null;
}
