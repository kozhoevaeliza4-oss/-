"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

type Field = { key: string; label: string };

export function MappingForm({
  action,
  sheets,
  fields,
  mapping,
  objects,
  stages,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  sheets: { name: string; headers: { index: number; label: string }[][]; rowCount: number }[];
  fields: Field[];
  mapping: {
    sheetIndex: number;
    headerRow: number;
    columns: Record<string, number | undefined>;
    sectionMode: string;
    keyMode: string;
    defaultObjectCode: string | null;
    defaultStageCode: string | null;
  };
  objects: { code: string; name: string }[];
  stages: { code: string; name: string }[];
}) {
  const [sheetIndex, setSheetIndex] = useState(mapping.sheetIndex);
  const [headerRow, setHeaderRow] = useState(mapping.headerRow);
  const headers = sheets[sheetIndex]?.headers[headerRow - 1] ?? [];
  const maxCols = Math.max(headers.length, ...Object.values(mapping.columns).map((v) => (v ?? 0) + 1));
  const colOptions = Array.from({ length: Math.max(maxCols, 1) }, (_, i) => headers.find((h) => h.index === i) ?? { index: i, label: colName(i) });

  return (
    <ActionForm action={action}>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">Лист</span>
          <select name="sheetIndex" className="input" value={sheetIndex} onChange={(e) => setSheetIndex(Number(e.target.value))}>
            {sheets.map((s, i) => (
              <option key={i} value={i}>{s.name} ({s.rowCount} строк)</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Строка заголовков</span>
          <input name="headerRow" type="number" min={1} className="input" value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <label key={f.key + sheetIndex + headerRow}>
            <span className="label">{f.label}</span>
            <select name={`col_${f.key}`} className="input" defaultValue={mapping.columns[f.key] ?? ""}>
              <option value="">— не используется —</option>
              {colOptions.map((c) => (
                <option key={c.index} value={c.index}>{c.label}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label className="block">
        <span className="label">Разделы сметы</span>
        <select name="sectionMode" className="input" defaultValue={mapping.sectionMode}>
          <option value="header-rows">Из строк-заголовков («Раздел 1. …»)</option>
          <option value="column">Из столбца «Раздел сметы»</option>
          <option value="none">Без разделов</option>
        </select>
      </label>
      <label className="block">
        <span className="label">Ключ сопоставления статей между версиями</span>
        <select name="keyMode" className="input" defaultValue={mapping.keyMode}>
          <option value="code_name">Корпус + раздел + код + наименование (надёжно, по умолчанию)</option>
          <option value="code">Корпус + раздел + код (переименование не создаёт новую статью)</option>
          <option value="lineNo">Корпус + раздел + № п/п</option>
        </select>
        <span className="mt-1 block text-xs text-slate-500">По ключу строки новой версии связываются с уже существующими статьями, договорами и фактом.</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">Корпус по умолчанию</span>
          <select name="defaultObjectCode" className="input" defaultValue={mapping.defaultObjectCode ?? ""}>
            <option value="">— не задан —</option>
            {objects.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Этап по умолчанию</span>
          <select name="defaultStageCode" className="input" defaultValue={mapping.defaultStageCode ?? ""}>
            <option value="">— не задан —</option>
            {stages.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
          </select>
        </label>
      </div>
      <SubmitButton className="btn-secondary" pendingText="Применение…">Применить сопоставление</SubmitButton>
    </ActionForm>
  );
}

function colName(i: number) {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
