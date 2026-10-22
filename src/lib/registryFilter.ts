/**
 * Фильтры реестра работ. Используются и в интерфейсе, и при экспорте — чтобы выгрузка
 * совпадала с тем, что пользователь видит на экране.
 */
import type { RegistryRowDTO } from "@/lib/server/registry";
import { REGISTRY_COLUMNS } from "./registryColumns";

export interface RegistryFilters {
  q?: string;
  object?: string;
  stage?: string;
  section?: string;
  contractor?: string;
  /** covered | uncovered | review */
  contract?: string;
  /** CoverageStatus */
  coverage?: string;
  /** 0 | partial | done | over | nodata */
  progress?: string;
  /** any | overrun | contractOver | reconcile */
  deviation?: string;
  /** signed | pending | none */
  acts?: string;
  /** green | yellow | red | grey | attention (red+yellow) */
  level?: string;
  overdue?: string;
  active?: string;
  endFrom?: string;
  endTo?: string;
  /** Состояние на дату */
  asOf?: string;
}

export const FILTER_KEYS: (keyof RegistryFilters)[] = [
  "q", "object", "stage", "section", "contractor", "contract", "coverage", "progress", "deviation", "acts", "level", "overdue", "active", "endFrom", "endTo", "asOf",
];

export function filtersFromParams(p: Record<string, string | string[] | undefined> | URLSearchParams): RegistryFilters {
  const get = (k: string) => (p instanceof URLSearchParams ? p.get(k) ?? undefined : (Array.isArray(p[k]) ? (p[k] as string[])[0] : (p[k] as string | undefined)));
  const f: RegistryFilters = {};
  for (const k of FILTER_KEYS) {
    const v = get(k);
    if (v) f[k] = v;
  }
  return f;
}

export function filtersToQuery(f: RegistryFilters): string {
  const sp = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k]) sp.set(k, f[k]!);
  return sp.toString();
}

const n = (v: string | null) => (v === null ? null : Number(v));

export function applyRegistryFilters(rows: RegistryRowDTO[], f: RegistryFilters): RegistryRowDTO[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.code ?? ""} ${r.name} ${r.contractors.join(" ")} ${r.contracts.map((c) => c.number).join(" ")}`.toLowerCase().includes(q)) return false;
    if (f.object && (f.object === "none" ? r.objectId !== null : r.objectId !== f.object)) return false;
    if (f.stage && (f.stage === "none" ? r.stageId !== null : r.stageId !== f.stage)) return false;
    if (f.section && (f.section === "none" ? r.sectionId !== null : r.sectionId !== f.section)) return false;
    if (f.contractor && (f.contractor === "none" ? r.contractors.length > 0 : !r.contractors.includes(f.contractor))) return false;
    if (f.contract === "covered" && !r.covered) return false;
    if (f.contract === "uncovered" && (r.covered || !r.active)) return false;
    if (f.contract === "review" && !(r.coverageStatus === "NEEDS_REVIEW" || r.coverageStatus === "NEEDS_CLARIFICATION")) return false;
    if (f.coverage && r.coverageStatus !== f.coverage) return false;
    if (f.progress) {
      const p = n(r.percentRaw);
      if (f.progress === "nodata" && p !== null) return false;
      if (f.progress === "0" && p !== 0) return false;
      if (f.progress === "partial" && !(p !== null && p > 0 && p < 100)) return false;
      if (f.progress === "done" && !(p !== null && p >= 100)) return false;
      if (f.progress === "notdone" && p !== null && p >= 100) return false;
      if (f.progress === "over" && r.overrunQuantity === null) return false;
    }
    if (f.deviation) {
      const has = (code: string) => r.flags.some((x) => x.code === code);
      if (f.deviation === "overrun" && !(has("COST_OVERRUN") || has("COST_OVERRUN_PRELIMINARY"))) return false;
      if (f.deviation === "contractOver" && !has("CONTRACT_OVER_PLAN")) return false;
      if (f.deviation === "reconcile" && !has("RECONCILE_ACTS")) return false;
      if (f.deviation === "volume" && r.overrunQuantity === null) return false;
      if (f.deviation === "any" && !r.flags.some((x) => ["COST_OVERRUN", "COST_OVERRUN_PRELIMINARY", "CONTRACT_OVER_PLAN", "RECONCILE_ACTS", "OVERRUN_UNCONFIRMED", "OVERRUN_CONFIRMED"].includes(x.code))) return false;
    }
    if (f.acts === "signed" && r.actsAccepted === null) return false;
    if (f.acts === "pending" && r.actsPending === null) return false;
    if (f.acts === "none" && (r.actsAccepted !== null || r.actsPending !== null)) return false;
    if (f.level) {
      if (f.level === "attention" ? !(r.level === "red" || r.level === "yellow") : r.level !== f.level) return false;
    }
    if (f.overdue === "1" && !r.overdue) return false;
    if (f.active === "1" && !r.active) return false;
    if (f.active === "0" && r.active) return false;
    if (f.endFrom && (!r.plannedEndDate || r.plannedEndDate < f.endFrom)) return false;
    if (f.endTo && (!r.plannedEndDate || r.plannedEndDate > f.endTo)) return false;
    return true;
  });
}


export interface SortSpec {
  key: string;
  dir: 1 | -1;
}

export function sortRegistry(rows: RegistryRowDTO[], sort: SortSpec | null): RegistryRowDTO[] {
  if (!sort) return rows;
  const col = REGISTRY_COLUMNS.find((c) => c.key === sort.key);
  if (!col) return rows;
  const numeric = col.kind === "money" || col.kind === "qty" || col.kind === "pct";
  return [...rows].sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1; // «нет данных» всегда в конце
    if (vb === null) return -1;
    if (numeric) return (Number(va) - Number(vb)) * sort.dir;
    return va.localeCompare(vb, "ru") * sort.dir;
  });
}
