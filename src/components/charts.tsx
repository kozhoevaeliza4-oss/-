import Link from "next/link";
import { fmtMoney, fmtPct } from "@/lib/format";

/**
 * Простые доступные графики: подписи значений всегда текстом, подсказки при наведении,
 * табличное представление; цвет — одна последовательная гамма для величин и
 * нейтральный/акцентный для пары «план — факт».
 */

export function BarList({
  items,
  format,
  max,
  emptyText = "Нет данных",
}: {
  items: { key: string; label: string; value: number | null; hint?: string; href?: string; display?: string }[];
  format: (v: number) => string;
  max?: number;
  emptyText?: string;
}) {
  if (!items.length) return <p className="text-sm text-slate-500">{emptyText}</p>;
  const m = max ?? Math.max(1, ...items.map((i) => i.value ?? 0));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => {
        const pct = i.value === null ? null : Math.max(0, Math.min(100, (i.value / m) * 100));
        const body = (
          <>
            <div className="flex justify-between gap-2 text-sm">
              <span className="truncate group-hover:underline">{i.label}</span>
              <span className="whitespace-nowrap font-medium tabular-nums">{i.display ?? (i.value === null ? "Нет данных" : format(i.value))}</span>
            </div>
            <div className="mt-1 h-2 rounded bg-slate-100" role="img" aria-label={`${i.label}: ${i.value === null ? "нет данных" : format(i.value)}`}>
              {pct !== null && <div className="h-2 rounded-r bg-blue-600" style={{ width: `${pct}%`, minWidth: pct > 0 ? 3 : 0 }} title={i.hint} />}
            </div>
            {i.hint && <div className="mt-0.5 text-xs text-slate-500">{i.hint}</div>}
          </>
        );
        return <li key={i.key}>{i.href ? <Link href={i.href} className="group block">{body}</Link> : <div>{body}</div>}</li>;
      })}
    </ul>
  );
}

/** Пара «план — факт» по группам. Цвета: план — нейтральный, факт — акцентный. Легенда и подписи всегда видны. */
export function PairBars({
  items,
  currency,
  labels,
}: {
  items: { key: string; label: string; a: number | null; b: number | null; href?: string }[];
  currency: string;
  labels: [string, string];
}) {
  if (!items.length) return <p className="text-sm text-slate-500">Нет данных</p>;
  const m = Math.max(1, ...items.flatMap((i) => [i.a ?? 0, i.b ?? 0]));
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-slate-400" />{labels[0]}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-blue-600" />{labels[1]}</span>
      </div>
      <ul className="space-y-3">
        {items.map((i) => (
          <li key={i.key}>
            <div className="mb-1 truncate text-sm">{i.href ? <Link className="hover:underline" href={i.href}>{i.label}</Link> : i.label}</div>
            {[{ v: i.a, cls: "bg-slate-400", name: labels[0] }, { v: i.b, cls: "bg-blue-600", name: labels[1] }].map((x) => (
              <div key={x.name} className="mb-0.5 flex items-center gap-2" title={`${x.name}: ${x.v === null ? "нет данных" : fmtMoney(x.v, currency)}`}>
                <div className="h-2 flex-1 rounded bg-slate-100">
                  {x.v !== null && <div className={`h-2 rounded-r ${x.cls}`} style={{ width: `${Math.max(0, (x.v / m) * 100)}%` }} />}
                </div>
                <span className="w-36 text-right text-xs tabular-nums text-slate-700">{x.v === null ? "—" : fmtMoney(x.v, currency)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Столбцы по месяцам (одна величина). */
export function MonthColumns({ points, currency, emptyText }: { points: { month: string; value: string }[]; currency: string; emptyText: string }) {
  if (!points.length) return <p className="text-sm text-slate-500">{emptyText}</p>;
  const vals = points.map((p) => Number(p.value));
  const m = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const label = (k: string) => new Date(k + "-01T00:00:00Z").toLocaleDateString("ru-RU", { month: "short", year: "2-digit", timeZone: "UTC" });
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5 border-b border-slate-200" role="img" aria-label="Динамика по месяцам">
        {points.map((p, i) => (
          <div key={p.month} className="group flex h-full flex-1 flex-col items-center justify-end" title={`${label(p.month)}: ${fmtMoney(vals[i], currency)}`}>
            <div className="w-full max-w-10 rounded-t bg-blue-600 group-hover:bg-blue-800" style={{ height: `${Math.max(2, (Math.abs(vals[i]) / m) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {points.map((p) => <div key={p.month} className="flex-1 text-center text-[10px] text-slate-500">{label(p.month)}</div>)}
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-slate-600">Таблица</summary>
        <table className="mt-1 w-full"><tbody>{points.map((p) => <tr key={p.month}><td>{label(p.month)}</td><td className="text-right tabular-nums">{fmtMoney(p.value, currency)}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}

/** Договорное покрытие: одна полоса «покрыто / без договора» с подписями. */
export function CoverageBar({ covered, uncovered, currency, percent, href }: { covered: number | null; uncovered: number | null; currency: string; percent: string | null; href: string }) {
  const total = (covered ?? 0) + (uncovered ?? 0);
  if (!total) return <p className="text-sm text-slate-500">Нет плановой стоимости для расчёта</p>;
  const c = ((covered ?? 0) / total) * 100;
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded" role="img" aria-label={`Покрыто ${fmtPct(percent)}`}>
        <div className="bg-blue-600" style={{ width: `${c}%` }} title={`Покрыто: ${fmtMoney(covered, currency)}`} />
        <div className="ml-0.5 flex-1 bg-slate-200" title={`Без договора: ${fmtMoney(uncovered, currency)}`} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-blue-600" />Покрыто договорами: <b>{fmtMoney(covered, currency)}</b> ({fmtPct(percent)})</span>
        <Link href={href} className="hover:underline"><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-slate-300" />Без договора: <b>{fmtMoney(uncovered, currency)}</b></Link>
      </div>
    </div>
  );
}
