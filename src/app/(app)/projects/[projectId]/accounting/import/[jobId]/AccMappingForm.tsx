"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

export function AccMappingForm({
  action,
  sheets,
  fields,
  mapping,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  sheets: { name: string; rowCount: number; headers: string[][] }[];
  fields: { key: string; label: string }[];
  mapping: { sheetIndex: number; headerRow: number; columns: Record<string, number | undefined>; amountMode: string; defaultAccount: string | null; defaultCurrency: string };
}) {
  const [sheetIndex, setSheet] = useState(mapping.sheetIndex);
  const [headerRow, setHeaderRow] = useState(mapping.headerRow);
  const headers = sheets[sheetIndex]?.headers[headerRow - 1] ?? [];
  const n = Math.max(headers.length, ...Object.values(mapping.columns).map((v) => (v ?? 0) + 1), 1);
  const col = (i: number) => {
    let s = "";
    let k = i + 1;
    while (k > 0) {
      s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
      k = Math.floor((k - 1) / 26);
    }
    return s;
  };
  return (
    <ActionForm action={action}>
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Лист</span>
          <select name="sheetIndex" className="input" value={sheetIndex} onChange={(e) => setSheet(Number(e.target.value))}>{sheets.map((s, i) => <option key={i} value={i}>{s.name} ({s.rowCount})</option>)}</select>
        </label>
        <label><span className="label">Строка заголовков</span><input name="headerRow" type="number" min={1} className="input" value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))} /></label>
      </div>
      <label className="block"><span className="label">Сумма операции</span>
        <select name="amountMode" defaultValue={mapping.amountMode} className="input">
          <option value="amount">Из столбца «Сумма» (со знаком)</option>
          <option value="debit_minus_credit">Дебет − кредит</option>
          <option value="debit">Только дебет</option>
          <option value="credit">Только кредит</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <label key={f.key + sheetIndex + headerRow}><span className="label">{f.label}</span>
            <select name={`col_${f.key}`} defaultValue={mapping.columns[f.key] ?? ""} className="input">
              <option value="">—</option>
              {Array.from({ length: n }, (_, i) => <option key={i} value={i}>{col(i)} — {(headers[i] ?? "").slice(0, 30)}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Счёт по умолчанию (если в файле нет)</span><input name="defaultAccount" defaultValue={mapping.defaultAccount ?? ""} className="input" placeholder="например, 1636" /></label>
        <label><span className="label">Валюта по умолчанию</span><input name="defaultCurrency" defaultValue={mapping.defaultCurrency} maxLength={3} className="input uppercase" /></label>
      </div>
      <SubmitButton className="btn-secondary">Применить сопоставление</SubmitButton>
    </ActionForm>
  );
}
