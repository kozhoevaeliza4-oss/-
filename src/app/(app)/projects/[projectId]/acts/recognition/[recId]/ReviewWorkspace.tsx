"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import type { ActionState } from "@/components/forms";
import { ItemPicker } from "@/components/ItemPicker";
import { Badge, type Tone } from "@/components/ui";
import { ACT_FIELDS, ActFieldKey, LINE_COLUMNS, LineColumn, LOW_CONFIDENCE } from "@/lib/extract/act";
import type { BBox } from "@/lib/extract/ocrTypes";
import type { ArithmeticCheck } from "@/lib/calc/actChecks";
import { confirmBlockers, DraftChecks, DraftFields, DraftLine, DraftMatches } from "@/lib/recognition/draft";
import { fmtMoney } from "@/lib/format";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export interface ReviewProps {
  projectId: string;
  recognitionId: string;
  currency: string;
  pages: { id: string; width: number | null; height: number | null; error: string | null; confidence: number | null; hasImage: boolean; name: string }[];
  fields: DraftFields;
  lines: DraftLine[];
  checks: DraftChecks | null;
  matches: DraftMatches | null;
  duplicates: { acts: { actId: string; number: string; date: string; status: string; total: string | null; contractor: string | null; reasons: string[]; strength: string }[]; recognitions: { id: string; createdAt: string }[] } | null;
  duplicateDecision: string | null;
  contracts: { id: string; label: string; contractorId: string | null }[];
  contractors: { id: string; name: string }[];
  saveAction: A;
  confirmAction: A;
}

const COL_LABEL: Record<LineColumn, string> = { lineNo: "№", code: "Шифр", name: "Наименование", unit: "Ед.", quantity: "Кол-во", unitPrice: "Цена", amount: "Сумма" };

const FIELD_GROUPS: { title: string; keys: ActFieldKey[] }[] = [
  { title: "Документ", keys: ["docType", "number", "date", "periodFrom", "periodTo", "currency"] },
  { title: "Стороны и договор", keys: ["customerName", "contractorName", "contractorInn", "contractNumber", "contractDate"] },
  { title: "Объект", keys: ["projectName", "objectText"] },
  { title: "Итоги по документу", keys: ["subtotal", "vatAmount", "total", "amountInWords"] },
  { title: "Подписанты", keys: ["signatories"] },
];

function statusOf(f: { status: string; value: string | null }): { tone: Tone; label: string } {
  if (f.status === "confirmed") return { tone: "green", label: "Подтверждено" };
  if (f.status === "edited") return { tone: "blue", label: "Исправлено" };
  if (f.status === "low_confidence") return { tone: "yellow", label: "Требует проверки" };
  if (f.status === "not_found" || !f.value) return { tone: "grey", label: "Не распознано" };
  return { tone: "green", label: "Распознано" };
}

let keySeq = 0;

export function ReviewWorkspace(p: ReviewProps) {
  const [fields, setFields] = useState<DraftFields>(p.fields);
  const [lines, setLines] = useState<DraftLine[]>(p.lines);
  const [contractId, setContractId] = useState<string | null>(p.matches?.selectedContractId ?? null);
  const [contractorId, setContractorId] = useState<string | null>(p.matches?.selectedContractorId ?? null);
  const [dupDecision, setDupDecision] = useState<string>(p.duplicateDecision ?? "");
  const [highlight, setHighlight] = useState<BBox | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [confirmStatus, setConfirmStatus] = useState<"DRAFT" | "ON_APPROVAL">("DRAFT");
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const mismatchLines = useMemo(() => new Set((p.checks?.arithmetic ?? []).filter((c) => c.code === "LINE_MISMATCH").flatMap((c) => c.lineIndexes)), [p.checks]);
  const dupFound = !!p.duplicates && (p.duplicates.acts.length > 0 || p.duplicates.recognitions.length > 0);
  const blockers = confirmBlockers(fields, lines, { duplicatesFound: dupFound, duplicateDecision: dupDecision });
  const linesTotal = lines.reduce((s, l) => s + (l.cells.amount.value ? Number(l.cells.amount.value) : 0), 0);

  const show = (b: BBox | null) => {
    setHighlight(b);
    if (b) pageRefs.current[b.page]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const touch = () => {
    setDirty(true);
    setMessage(null);
  };
  const setField = (k: ActFieldKey, value: string) => {
    touch();
    setFields((f) => ({ ...f, [k]: { ...f[k], original: f[k].original ?? f[k].raw ?? f[k].value, value: value === "" ? null : value, status: "edited" } }));
  };
  const confirmField = (k: ActFieldKey) => {
    touch();
    setFields((f) => ({ ...f, [k]: { ...f[k], status: "confirmed" } }));
  };
  const confirmAllRecognized = () => {
    touch();
    setFields((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value && (v.status === "recognized" || v.status === "low_confidence") ? { ...v, status: "confirmed" } : v])) as DraftFields);
  };
  const updateLine = (i: number, fn: (l: DraftLine) => DraftLine) => {
    touch();
    setLines((ls) => ls.map((l, k) => (k === i ? fn(l) : l)));
  };
  const setCell = (i: number, c: LineColumn, value: string) =>
    updateLine(i, (l) => ({ ...l, cells: { ...l.cells, [c]: { ...l.cells[c], original: l.cells[c].original ?? l.cells[c].raw, value: value === "" ? null : value, edited: true } } }));
  const addLine = () => {
    touch();
    const empty = () => ({ raw: null, value: null, confidence: null, edited: true });
    setLines((ls) => [
      ...ls,
      { key: `manual-${Date.now()}-${keySeq++}`, page: null, bbox: null, section: null, cells: Object.fromEntries(LINE_COLUMNS.map((c) => [c, empty()])) as DraftLine["cells"], verified: false, manual: true, allocations: [], match: null, unmatchedAccepted: false },
    ]);
  };

  const draftFormData = () => {
    const fd = new FormData();
    fd.append("draft", JSON.stringify({ fields, lines, selectedContractId: contractId, selectedContractorId: contractorId, duplicateDecision: dupDecision.trim() || null }));
    return fd;
  };
  const save = (after?: () => void) =>
    start(async () => {
      const r = await p.saveAction(null, draftFormData());
      if (r?.ok) {
        setDirty(false);
        setMessage({ ok: true, text: r.message ?? "Сохранено" });
        after?.();
      } else setMessage({ ok: false, text: r?.error ?? "Ошибка сохранения" });
    });
  const confirm = () => {
    if (!window.confirm(`Создать АВР № ${fields.number.value ?? ""} на сумму ${fmtMoney(linesTotal, fields.currency?.value ?? p.currency)} в статусе «${confirmStatus === "DRAFT" ? "черновик" : "на согласовании"}»? Акт не будет помечен подписанным.`)) return;
    start(async () => {
      const s = await p.saveAction(null, draftFormData());
      if (!s?.ok) {
        setMessage({ ok: false, text: s?.error ?? "Ошибка сохранения" });
        return;
      }
      setDirty(false);
      const fd = new FormData();
      fd.append("status", confirmStatus);
      const r = await p.confirmAction(null, fd);
      if (r && !r.ok) setMessage({ ok: false, text: r.error ?? "Ошибка подтверждения" });
    });
  };

  return (
    <div className="grid gap-4 pb-24 lg:grid-cols-2 lg:pb-4">
      {/* Оригинал */}
      <section className="card lg:sticky lg:top-2 lg:max-h-[calc(100vh-1rem)] lg:overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm">
          <span className="font-semibold">Документ ({p.pages.length} стр.)</span>
          <span className="flex items-center gap-1">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Уменьшить">−</button>
            <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Увеличить">+</button>
          </span>
        </div>
        <div className="max-h-[60vh] overflow-auto bg-slate-100 p-2 lg:max-h-[calc(100vh-4rem)]">
          {p.pages.map((pg, i) => (
            <div key={pg.id} ref={(el) => { pageRefs.current[i + 1] = el; }} className="mb-3">
              <div className="mb-1 flex justify-between text-xs text-slate-600">
                <span>Стр. {i + 1} · {pg.name}</span>
                {pg.confidence !== null && <span className={pg.confidence < LOW_CONFIDENCE ? "text-amber-700" : ""}>качество OCR {Math.round(pg.confidence)}%</span>}
              </div>
              {pg.hasImage ? (
                <div className="relative mx-auto bg-white shadow" style={{ width: `${zoom * 100}%` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/recognition-pages/${pg.id}?v=processed`} alt={`Страница ${i + 1}`} className="block w-full" />
                  {highlight && highlight.page === i + 1 && (
                    <div
                      className="pointer-events-none absolute rounded-sm border-2 border-blue-600 bg-blue-500/15"
                      style={{ left: `${highlight.x * 100}%`, top: `${highlight.y * 100}%`, width: `${highlight.w * 100}%`, height: `${highlight.h * 100}%` }}
                    />
                  )}
                </div>
              ) : (
                <div className="rounded border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">{pg.error ?? "Изображение страницы недоступно"}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Распознанные данные */}
      <section className="space-y-4">
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Реквизиты</h2>
            <button type="button" className="btn-secondary btn-sm" onClick={confirmAllRecognized}>Подтвердить все сверенные</button>
          </div>
          <p className="mb-3 text-xs text-slate-500">Нажмите на поле — соответствующий участок подсветится на оригинале. Исходное распознанное значение сохраняется.</p>
          {FIELD_GROUPS.map((g) => (
            <fieldset key={g.title} className="mb-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.keys.map((k) => {
                  const f = fields[k];
                  const st = statusOf(f);
                  const isDate = ["date", "periodFrom", "periodTo", "contractDate"].includes(k);
                  return (
                    <label key={k} className={`block rounded border p-2 ${f.status === "low_confidence" ? "border-amber-400 bg-amber-50/60" : "border-slate-200"} ${k === "amountInWords" || k === "signatories" ? "sm:col-span-2" : ""}`}>
                      <span className="mb-1 flex items-center justify-between gap-1 text-xs">
                        <span className="font-medium text-slate-700">{ACT_FIELDS[k]}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </span>
                      <input
                        className="input"
                        type={isDate ? "date" : "text"}
                        value={f.value ?? ""}
                        onFocus={() => show(f.bbox)}
                        onChange={(e) => setField(k, e.target.value)}
                        placeholder="не распознано"
                      />
                      <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate" title={f.original ?? f.raw ?? ""}>
                          {(f.original ?? f.raw) ? <>распознано: «{f.original ?? f.raw}»</> : "—"}
                          {f.confidence !== null && <> · уверенность {f.confidence}%</>}
                          {f.corrected && <> · исправлены похожие символы</>}
                        </span>
                        {f.value && (f.status === "low_confidence" || f.status === "recognized") && (
                          <button type="button" className="link whitespace-nowrap" onClick={(e) => { e.preventDefault(); confirmField(k); }}>Верно</button>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Договор в системе {p.matches?.contract && <MatchBadge level={p.matches.contract.level} />}</span>
              <select className="input" value={contractId ?? ""} onChange={(e) => { touch(); setContractId(e.target.value || null); const c = p.contracts.find((x) => x.id === e.target.value); if (c?.contractorId) setContractorId(c.contractorId); }}>
                <option value="">— акт без договора —</option>
                {p.contracts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {p.matches?.contract?.suggestions.length ? (
                <span className="mt-1 block text-[11px] text-slate-500">Предложено: {p.matches.contract.suggestions.map((s) => `${s.label} (${s.reasons.join(", ")})`).join("; ")}</span>
              ) : <span className="mt-1 block text-[11px] text-amber-700">Договор автоматически не найден — выберите вручную или оставьте без договора</span>}
            </label>
            <label className="block">
              <span className="label">Подрядчик в системе</span>
              <select className="input" value={contractorId ?? ""} onChange={(e) => { touch(); setContractorId(e.target.value || null); }}>
                <option value="">— не выбран —</option>
                {p.contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Позиции акта ({lines.length}) · сумма строк {fmtMoney(linesTotal, fields.currency?.value ?? p.currency)}</h2>
            <button type="button" className="btn-secondary btn-sm" onClick={addLine}>+ Добавить строку</button>
          </div>
          {lines.length === 0 && <p className="text-sm text-slate-500">Строки не распознаны. Добавьте их вручную по оригиналу.</p>}
          <div className="space-y-3">
            {lines.map((l, i) => (
              <LineCard
                key={l.key}
                index={i}
                line={l}
                projectId={p.projectId}
                mismatch={mismatchLines.has(i)}
                onShow={() => show(l.bbox)}
                onCell={(c, v) => setCell(i, c, v)}
                onChange={(fn) => updateLine(i, fn)}
                onDelete={() => { if (window.confirm("Удалить строку из черновика? Оригинал документа не изменится.")) { touch(); setLines((ls) => ls.filter((_, k) => k !== i)); } }}
              />
            ))}
          </div>
        </div>

        <ChecksPanel checks={p.checks} currency={fields.currency?.value ?? p.currency} />

        {dupFound && (
          <div className="card border-red-300 p-3">
            <h2 className="mb-2 text-sm font-semibold text-red-800"><Badge tone="red">Возможный дубликат</Badge></h2>
            <ul className="mb-2 space-y-1 text-sm">
              {p.duplicates!.acts.map((d) => (
                <li key={d.actId}>
                  <Link className="link" href={`/projects/${p.projectId}/acts/${d.actId}`} target="_blank">Акт № {d.number} от {d.date}</Link> · {fmtMoney(d.total, p.currency)} · {d.contractor ?? "—"} — <span className="text-slate-600">{d.reasons.join(", ")}</span> {d.strength === "exact" && <Badge tone="red">тот же файл</Badge>}
                </li>
              ))}
              {p.duplicates!.recognitions.map((r) => (
                <li key={r.id}><Link className="link" href={`/projects/${p.projectId}/acts/recognition/${r.id}`} target="_blank">Другой черновик распознавания</Link> с той же фотографией ({new Date(r.createdAt).toLocaleString("ru-RU")})</li>
              ))}
            </ul>
            <label className="block">
              <span className="label">Если это другой документ — укажите, чем он отличается (обязательно для подтверждения)</span>
              <input className="input" value={dupDecision} onChange={(e) => { touch(); setDupDecision(e.target.value); }} placeholder="Например: акт за другой период, другая очередь работ" />
            </label>
            <p className="mt-1 text-xs text-slate-500">Повторный акт не создаётся без вашего решения. Если это повтор — отмените загрузку.</p>
          </div>
        )}

        {blockers.length > 0 && (
          <div className="card p-3">
            <h2 className="mb-1 text-sm font-semibold">Перед подтверждением</h2>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-700">{blockers.slice(0, 15).map((b, k) => <li key={k}>{b.text}</li>)}</ul>
            {blockers.length > 15 && <p className="text-xs text-slate-500">…и ещё {blockers.length - 15}</p>}
          </div>
        )}
      </section>

      {/* Панель действий */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:static lg:col-span-2 lg:rounded-lg lg:border">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => save()} disabled={pending}>{pending ? "…" : dirty ? "Сохранить изменения" : "Сохранить и пересчитать проверки"}</button>
          <select className="input w-auto" value={confirmStatus} onChange={(e) => setConfirmStatus(e.target.value as "DRAFT" | "ON_APPROVAL")}>
            <option value="DRAFT">Создать акт: черновик</option>
            <option value="ON_APPROVAL">Создать акт: на согласовании</option>
          </select>
          <button type="button" className="btn-primary" onClick={confirm} disabled={pending || blockers.length > 0} title={blockers.length ? "Устраните замечания" : undefined}>
            Подтвердить документ
          </button>
          {dirty && <span className="text-xs text-amber-700">Есть несохранённые изменения</span>}
          {message && <span role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</span>}
        </div>
      </div>
    </div>
  );
}

function MatchBadge({ level }: { level: "high" | "medium" | "low" }) {
  return level === "high" ? <Badge tone="green">высокая уверенность</Badge> : level === "medium" ? <Badge tone="yellow">средняя уверенность</Badge> : <Badge tone="red">не найдено</Badge>;
}

function LineCard({
  index,
  line: l,
  projectId,
  mismatch,
  onShow,
  onCell,
  onChange,
  onDelete,
}: {
  index: number;
  line: DraftLine;
  projectId: string;
  mismatch: boolean;
  onShow: () => void;
  onCell: (c: LineColumn, v: string) => void;
  onChange: (fn: (l: DraftLine) => DraftLine) => void;
  onDelete: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const lowCells = LINE_COLUMNS.filter((c) => l.cells[c].value && ((l.cells[c].confidence ?? 100) < LOW_CONFIDENCE || l.cells[c].corrected) && !l.cells[c].edited);
  const allocSum = l.allocations.reduce((s, a) => s + (a.amount ? Number(a.amount) : 0), 0);
  const amount = l.cells.amount.value ? Number(l.cells.amount.value) : null;
  const border = mismatch ? "border-red-400" : !l.allocations.length && !l.unmatchedAccepted ? "border-purple-300" : lowCells.length ? "border-amber-400" : l.verified ? "border-emerald-300" : "border-slate-200";
  const addAlloc = (id: string, label: string) =>
    onChange((x) => ({
      ...x,
      unmatchedAccepted: false,
      allocations: x.allocations.some((a) => a.workItemId === id)
        ? x.allocations
        : [...x.allocations, { workItemId: id, label, quantity: x.allocations.length ? null : x.cells.quantity.value, amount: x.allocations.length ? null : x.cells.amount.value, confirmed: true }],
    }));

  return (
    <div className={`rounded-md border-2 p-2 ${border}`} onClick={onShow}>
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        <span className="font-semibold">Строка {index + 1}</span>
        {l.page && <span className="text-slate-500">стр. {l.page}</span>}
        {l.section && <span className="truncate text-slate-500">· {l.section}</span>}
        {l.manual && <Badge tone="blue">добавлена вручную</Badge>}
        {mismatch && <Badge tone="red">Арифметическое расхождение</Badge>}
        {lowCells.length > 0 && <Badge tone="yellow">Требует проверки: {lowCells.map((c) => COL_LABEL[c]).join(", ")}</Badge>}
        {!l.allocations.length && !l.unmatchedAccepted && <Badge tone="red">Не найдено соответствие</Badge>}
        {l.verified && <Badge tone="green">Проверено</Badge>}
        <button type="button" className="ml-auto text-red-700 hover:underline" onClick={(e) => { e.stopPropagation(); onDelete(); }}>Удалить строку</button>
      </div>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
        {LINE_COLUMNS.map((c) => {
          const cell = l.cells[c];
          const low = lowCells.includes(c);
          const span = c === "name" ? "col-span-6 sm:col-span-5" : c === "code" ? "col-span-3 sm:col-span-2" : c === "lineNo" || c === "unit" ? "col-span-3 sm:col-span-1" : "col-span-2 sm:col-span-1";
          return (
            <label key={c} className={`${span} ${c === "amount" ? "sm:col-span-2" : ""}`}>
              <span className="block text-[10px] text-slate-500">{COL_LABEL[c]}</span>
              <input
                className={`input px-1.5 py-1 text-xs ${low ? "border-amber-500 bg-amber-50" : ""} ${["quantity", "unitPrice", "amount"].includes(c) ? "text-right tabular-nums" : ""}`}
                value={cell.value ?? ""}
                onChange={(e) => onCell(c, e.target.value)}
                title={cell.original || cell.raw ? `распознано: «${cell.original ?? cell.raw}»${cell.confidence !== null ? `, уверенность ${cell.confidence}%` : ""}` : "не распознано"}
              />
            </label>
          );
        })}
      </div>

      <div className="mt-2 rounded bg-slate-50 p-2 text-xs">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-medium">Статьи сметы</span>
          {l.match && <MatchBadge level={l.match.level} />}
        </div>
        {l.allocations.map((a, k) => (
          <div key={a.workItemId} className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate" title={a.label}>{a.label}</span>
            <input className="input w-20 px-1 py-0.5 text-right text-xs" placeholder="объём" value={a.quantity ?? ""} onChange={(e) => onChange((x) => ({ ...x, allocations: x.allocations.map((y, j) => (j === k ? { ...y, quantity: e.target.value || null } : y)) }))} />
            <input className="input w-28 px-1 py-0.5 text-right text-xs" placeholder="сумма" value={a.amount ?? ""} onChange={(e) => onChange((x) => ({ ...x, allocations: x.allocations.map((y, j) => (j === k ? { ...y, amount: e.target.value || null } : y)) }))} />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={a.confirmed} onChange={(e) => onChange((x) => ({ ...x, allocations: x.allocations.map((y, j) => (j === k ? { ...y, confirmed: e.target.checked } : y)) }))} />
              {a.confirmed ? "подтверждено" : <span className="font-semibold text-amber-700">подтвердить</span>}
            </label>
            <button type="button" className="text-red-700" onClick={() => onChange((x) => ({ ...x, allocations: x.allocations.filter((_, j) => j !== k) }))} aria-label="Убрать">✕</button>
          </div>
        ))}
        {l.allocations.length > 1 && amount !== null && Math.abs(allocSum - amount) > 0.01 && (
          <p className="text-amber-700">Распределено {allocSum.toFixed(2)} из {amount.toFixed(2)}</p>
        )}
        {l.match && l.match.suggestions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {l.match.suggestions.filter((s) => !l.allocations.some((a) => a.workItemId === s.workItemId)).slice(0, 3).map((s) => (
              <button key={s.workItemId} type="button" className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-left hover:border-blue-500" onClick={() => addAlloc(s.workItemId, s.label)} title={s.reasons.join(", ")}>
                + {s.label} <span className="text-slate-500">({Math.round(s.score * 100)}%)</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {picking ? (
            <div className="min-w-[260px] flex-1" onClick={(e) => e.stopPropagation()}>
              <ItemPicker projectId={projectId} name={`pick-${l.key}`} onChange={(it) => { if (it) { addAlloc(it.id, it.label); setPicking(false); } }} />
            </div>
          ) : (
            <button type="button" className="link" onClick={() => setPicking(true)}>Найти статью…</button>
          )}
          {!l.allocations.length && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={l.unmatchedAccepted} onChange={(e) => onChange((x) => ({ ...x, unmatchedAccepted: e.target.checked }))} />
              Нет в смете/договоре — оставить для решения ответственного
            </label>
          )}
        </div>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={l.verified} onChange={(e) => onChange((x) => ({ ...x, verified: e.target.checked }))} />
        Значения строки сверены с оригиналом
      </label>
    </div>
  );
}

function ChecksPanel({ checks, currency }: { checks: DraftChecks | null; currency: string }) {
  if (!checks) return null;
  const tone = (c: ArithmeticCheck): Tone => (c.level === "ok" ? "green" : c.level === "warning" || c.level === "error" ? "red" : "yellow");
  return (
    <div className="card p-3">
      <h2 className="mb-2 text-sm font-semibold">Проверки</h2>
      <ul className="space-y-1.5 text-xs">
        {checks.arithmetic.map((c, k) => (
          <li key={k} className="flex flex-wrap items-baseline gap-1">
            <Badge tone={tone(c)}>{c.level === "ok" ? "Сходится" : c.level === "info" ? "Пояснение" : c.code.includes("MISMATCH") ? "Арифметическое расхождение" : "Требует проверки"}</Badge>
            <span>{c.message}</span>
            {c.difference && c.level !== "ok" && (
              <span className="text-slate-600">— по документу {fmtMoney(c.documentValue, currency)}, расчёт {fmtMoney(c.computedValue, currency)}, разница {fmtMoney(c.difference, currency)}</span>
            )}
          </li>
        ))}
        {checks.warnings.map((w) => <li key={w}><Badge tone="yellow">Внимание</Badge> {w}</li>)}
        {checks.preprocessing.map((w) => <li key={w} className="text-slate-500">{w}</li>)}
      </ul>
      <p className="mt-2 text-[11px] text-slate-500">Исходные значения документа не исправляются автоматически. Расхождение — повод для проверки, а не автоматическая ошибка.</p>
    </div>
  );
}
