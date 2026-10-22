"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Decimal from "decimal.js";
import type { RegistryRowDTO } from "@/lib/server/registry";
import { REGISTRY_COLUMNS, RegistryColumn } from "@/lib/registryColumns";
import { applyRegistryFilters, filtersToQuery, RegistryFilters } from "@/lib/registryFilter";
import { fmtDate, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { Badge, type Tone } from "@/components/ui";
import { COVERAGE_LABELS } from "@/lib/calc/coverage";

type Opt = { id: string; name: string };

const STORAGE_KEY = "registry.columns.v1";
const MAX_ROWS = 3000;

export function RegistryTable({
  projectId,
  currency,
  rows,
  initialFilters,
  options,
  canExport,
  methodologyConfirmed,
}: {
  projectId: string;
  currency: string;
  rows: RegistryRowDTO[];
  initialFilters: RegistryFilters;
  options: { objects: Opt[]; stages: Opt[]; sections: Opt[]; contractors: string[] };
  canExport: boolean;
  methodologyConfirmed: boolean;
}) {
  const [filters, setFilters] = useState<RegistryFilters>(initialFilters);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(REGISTRY_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)));

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setVisible(new Set(JSON.parse(saved) as string[]));
    } catch {
      /* localStorage недоступен — используем столбцы по умолчанию */
    }
  }, []);
  const toggleColumn = (key: string) => {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisible(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  const query = filtersToQuery(filters);
  useEffect(() => {
    const url = `${window.location.pathname}${query ? "?" + query : ""}`;
    window.history.replaceState(null, "", url);
  }, [query]);

  const filtered = useMemo(() => applyRegistryFilters(rows, filters), [rows, filters]);
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = REGISTRY_COLUMNS.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const numeric = col.kind === "money" || col.kind === "qty" || col.kind === "pct";
    return [...filtered].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // «нет данных» всегда в конце
      if (vb === null) return -1;
      if (numeric) return (Number(va) - Number(vb)) * sort.dir;
      return va.localeCompare(vb, "ru") * sort.dir;
    });
  }, [filtered, sort]);

  const columns = REGISTRY_COLUMNS.filter((c) => visible.has(c.key));
  const totals = useMemo(() => {
    const t: Record<string, { sum: Decimal; missing: number }> = {};
    for (const c of columns) {
      if (c.kind !== "money") continue;
      let sum = new Decimal(0);
      let missing = 0;
      for (const r of filtered) {
        const v = c.value(r);
        if (v === null) missing++;
        else sum = sum.plus(v);
      }
      t[c.key] = { sum, missing };
    }
    return t;
  }, [columns, filtered]);

  const set = (k: keyof RegistryFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value || undefined }));
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <label className="col-span-2">
            <span className="label">Поиск</span>
            <input className="input" placeholder="Код, наименование, подрядчик, № договора" value={filters.q ?? ""} onChange={set("q")} />
          </label>
          <Sel label="Корпус" value={filters.object} onChange={set("object")} options={options.objects} noneLabel="Без корпуса" />
          <Sel label="Этап" value={filters.stage} onChange={set("stage")} options={options.stages} noneLabel="Без этапа" />
          <Sel label="Раздел сметы" value={filters.section} onChange={set("section")} options={options.sections} noneLabel="Без раздела" />
          <Sel label="Подрядчик" value={filters.contractor} onChange={set("contractor")} options={options.contractors.map((c) => ({ id: c, name: c }))} noneLabel="Без подрядчика" />
          <Sel
            label="Наличие договора"
            value={filters.contract}
            onChange={set("contract")}
            options={[
              { id: "covered", name: "Покрыто договором" },
              { id: "uncovered", name: "Без договора" },
              { id: "review", name: "Требует проверки" },
            ]}
          />
          <Sel label="Статус договора" value={filters.coverage} onChange={set("coverage")} options={Object.entries(COVERAGE_LABELS).map(([id, name]) => ({ id, name }))} />
          <Sel
            label="Готовность"
            value={filters.progress}
            onChange={set("progress")}
            options={[
              { id: "nodata", name: "Нет данных" },
              { id: "0", name: "0 %" },
              { id: "partial", name: "1–99 %" },
              { id: "notdone", name: "Не завершено" },
              { id: "done", name: "100 % и более" },
              { id: "over", name: "Превышение объёма" },
            ]}
          />
          <Sel
            label="Отклонения"
            value={filters.deviation}
            onChange={set("deviation")}
            options={[
              { id: "any", name: "Любые отклонения" },
              { id: "overrun", name: "Превышение затрат" },
              { id: "contractOver", name: "Договор выше плана" },
              { id: "reconcile", name: "Расхождение с АВР" },
              { id: "volume", name: "Превышение объёма" },
            ]}
          />
          <Sel
            label="АВР"
            value={filters.acts}
            onChange={set("acts")}
            options={[
              { id: "signed", name: "Есть подписанные" },
              { id: "pending", name: "Есть на согласовании" },
              { id: "none", name: "Нет АВР" },
            ]}
          />
          <Sel
            label="Статус проверки"
            value={filters.level}
            onChange={set("level")}
            options={[
              { id: "attention", name: "Требуют внимания (красные и жёлтые)" },
              { id: "red", name: "Красный — существенные отклонения" },
              { id: "yellow", name: "Жёлтый — требуется проверка" },
              { id: "grey", name: "Серый — недостаточно данных" },
              { id: "green", name: "Зелёный — подтверждено" },
            ]}
          />
          <Sel label="Сроки" value={filters.overdue} onChange={set("overdue")} options={[{ id: "1", name: "Просроченные" }]} />
          <Sel label="В смете" value={filters.active} onChange={set("active")} options={[{ id: "1", name: "Действующие статьи" }, { id: "0", name: "Нет в действующей смете" }]} />
          <label>
            <span className="label">Завершение (план) с</span>
            <input type="date" className="input" value={filters.endFrom ?? ""} onChange={set("endFrom")} />
          </label>
          <label>
            <span className="label">по</span>
            <input type="date" className="input" value={filters.endTo ?? ""} onChange={set("endTo")} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">
            Найдено статей: <b>{filtered.length}</b> из {rows.length}
          </span>
          {activeCount > 0 && (
            <button className="btn-secondary btn-sm" onClick={() => setFilters({})}>
              Сбросить фильтры ({activeCount})
            </button>
          )}
          <details className="relative">
            <summary className="btn-secondary btn-sm cursor-pointer list-none">Столбцы ({columns.length})</summary>
            <div className="absolute z-20 mt-1 max-h-96 w-72 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              {REGISTRY_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs">
                  <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggleColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          </details>
          {canExport && (
            <a className="btn-secondary btn-sm" href={`/api/projects/${projectId}/registry/export${query ? "?" + query : ""}`}>
              Экспорт в Excel
            </a>
          )}
          {!methodologyConfirmed && (
            <span className="text-xs text-amber-800">Методика 1С не согласована: «Затраты по данным 1С» — импортированные суммы, отклонения предварительные.</span>
          )}
        </div>
      </div>

      <div className="card overflow-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
        <table className="table-base text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`cursor-pointer select-none whitespace-nowrap ${c.kind === "money" || c.kind === "qty" || c.kind === "pct" ? "text-right" : ""}`}
                  onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                >
                  {c.key === "accountingCost" && !methodologyConfirmed ? "Импортированные затраты 1С" : c.label}
                  {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, MAX_ROWS).map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {columns.map((c) => (
                  <td key={c.key} className={c.kind === "money" || c.kind === "qty" || c.kind === "pct" ? "num" : c.key === "name" ? "min-w-[260px]" : ""}>
                    <CellView col={c} row={r} projectId={projectId} currency={currency} />
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center text-slate-500">
                  {rows.length === 0 ? "В реестре нет статей. Загрузите и утвердите смету." : "Нет статей, удовлетворяющих фильтрам."}
                </td>
              </tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="sticky bottom-0 bg-slate-50 font-semibold">
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={c.kind === "money" ? "num border-t border-slate-300" : "border-t border-slate-300"}>
                    {i === 0 ? "Итого по выборке" : totals[c.key] ? (
                      <span title={totals[c.key].missing ? `Без данных: ${totals[c.key].missing} статей — не включены в сумму` : undefined}>
                        {fmtMoney(totals[c.key].sum, currency)}
                        {totals[c.key].missing > 0 && <span className="block text-[10px] font-normal text-slate-500">без данных: {totals[c.key].missing}</span>}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {sorted.length > MAX_ROWS && <p className="p-2 text-xs text-slate-500">Показаны первые {MAX_ROWS} строк. Уточните фильтры или используйте экспорт.</p>}
      </div>
    </div>
  );
}

const LEVEL_TONE: Record<string, Tone> = { green: "green", yellow: "yellow", red: "red", grey: "grey" };
const COVERAGE_TONE: Record<string, Tone> = {
  NONE: "red",
  NEEDS_REVIEW: "yellow",
  ACTIVE: "green",
  COMPLETED: "green",
  TERMINATED: "red",
  NEEDS_CLARIFICATION: "yellow",
};

function CellView({ col, row, projectId, currency }: { col: RegistryColumn; row: RegistryRowDTO; projectId: string; currency: string }) {
  switch (col.key) {
    case "status":
      return (
        <span title={row.flags.map((f) => "• " + f.text).join("\n") || "Замечаний нет"}>
          <Badge tone={LEVEL_TONE[row.level]}>{row.levelLabel}</Badge>
          {row.flags.length > 0 && <span className="ml-1 text-[10px] text-slate-500">({row.flags.length})</span>}
        </span>
      );
    case "name":
      return (
        <>
          <Link href={`/projects/${projectId}/items/${row.id}`} className="link">
            {row.name}
          </Link>
          {!row.active && <div className="text-[10px] text-slate-500">нет в действующей смете{row.origin === "MANUAL" ? " · добавлена вручную" : ""}</div>}
          {row.measurementType === "PERCENT" && <div className="text-[10px] text-slate-500">готовность вводится в %</div>}
        </>
      );
    case "coverage":
      return <Badge tone={COVERAGE_TONE[row.coverageStatus]}>{row.coverageLabel}</Badge>;
    case "percent":
      if (row.percentDisplay === null) return <NoData />;
      return (
        <span>
          {fmtPct(row.percentDisplay)}
          {row.overrunQuantity !== null && (
            <span className="block text-[10px] text-red-700">
              факт {fmtPct(row.percentRaw)}, +{fmtNum(row.overrunQuantity, 4)} {row.unit ?? ""} {row.overrunConfirmed ? "(подтв.)" : "(не подтв.)"}
            </span>
          )}
        </span>
      );
    case "variance": {
      if (row.variance === null) return <NoData />;
      const v = Number(row.variance);
      return (
        <span className={v > 0 ? "text-red-700" : v < 0 ? "text-emerald-700" : ""} title={row.varianceComparable ? undefined : "Предварительно: методика 1С не согласована"}>
          {v > 0 ? "+" : ""}
          {fmtMoney(row.variance, currency)}
          {!row.varianceComparable && <span className="block text-[10px] text-slate-500">предварительно</span>}
        </span>
      );
    }
    case "earnedValue":
      if (row.earnedValue === null) return <NoData />;
      return (
        <span>
          {fmtMoney(row.earnedValue, currency)}
          {row.unconfirmedOverrunValue && <span className="block text-[10px] text-red-700">+{fmtMoney(row.unconfirmedOverrunValue, currency)} не подтв.</span>}
        </span>
      );
    case "forecast":
      return row.forecast === null ? <span className="text-[10px] text-slate-500">{row.forecastReason}</span> : <>{fmtMoney(row.forecast, currency)}</>;
    case "contractAmount":
      return row.contractAmount === null ? <NoData /> : <>{fmtMoney(row.contractAmount, currency)}{row.contractAmountIncomplete && <span className="block text-[10px] text-amber-700">не по всем договорам</span>}</>;
    case "plannedEndDate":
      return <span className={row.overdue ? "font-semibold text-red-700" : ""}>{fmtDate(row.plannedEndDate)}{row.overdue && <span className="block text-[10px]">просрочено</span>}</span>;
  }
  const v = col.value(row);
  if (v === null) return <NoData />;
  switch (col.kind) {
    case "money":
      return <>{fmtMoney(v, currency)}</>;
    case "qty":
      return <span className={Number(v) < 0 ? "text-red-700" : ""}>{fmtNum(v, 4)}</span>;
    case "pct":
      return <>{fmtPct(v)}</>;
    case "date":
      return <>{fmtDate(v)}</>;
    default:
      return <>{v}</>;
  }
}

function NoData() {
  return (
    <span className="text-slate-400" title="Нет данных">
      —
    </span>
  );
}

function Sel({
  label,
  value,
  onChange,
  options,
  noneLabel,
}: {
  label: string;
  value?: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: Opt[];
  noneLabel?: string;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="input" value={value ?? ""} onChange={onChange}>
        <option value="">Все</option>
        {noneLabel && <option value="none">{noneLabel}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
