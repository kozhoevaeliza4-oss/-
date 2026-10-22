import "server-only";
import type { ProjectAccess } from "./auth";
import type { RegistryRowDTO } from "./registry";
import type { Permission } from "@/lib/permissions";
import { LEVEL_LABELS, rowLevel } from "@/lib/calc/registryRow";

/**
 * Видимость финансовых данных по правам роли. Данные, к которым нет доступа, удаляются на сервере
 * (а не скрываются в интерфейсе) и помечаются, чтобы не показывать их как «нет данных».
 */
export interface Visibility {
  accounting: boolean;
  contracts: boolean;
  acts: boolean;
}

export function visibilityOf(access: Pick<ProjectAccess, "can">): Visibility {
  return { accounting: access.can("accounting.view"), contracts: access.can("contract.view"), acts: access.can("act.view") };
}

const COST_FLAGS = ["COST_OVERRUN", "COST_OVERRUN_PRELIMINARY"];
const CONTRACT_FLAGS = ["WORK_WITHOUT_CONTRACT", "NO_CONTRACT", "CONTRACT_OVER_PLAN", "MULTIPLE_CONTRACTS", "PARTIAL_VOLUME", "CONTRACT_REVIEW"];
const ACT_FLAGS = ["RECONCILE_ACTS", "ACT_CURRENCY"];

export function redactRow(r: RegistryRowDTO, v: Visibility): RegistryRowDTO {
  if (v.accounting && v.contracts && v.acts) return r;
  const out: RegistryRowDTO = { ...r, hidden: [...(r.hidden ?? [])] };
  if (!v.accounting) {
    Object.assign(out, { accountingCost: null, variance: null, variancePercent: null, forecast: null, forecastReason: "нет доступа", paid: null });
    out.hidden!.push("accounting");
    out.flags = out.flags.filter((f) => !COST_FLAGS.includes(f.code));
  }
  if (!v.contracts) {
    Object.assign(out, { contractors: [], contracts: [], contractAmount: null, contractVsPlan: null, contractAmountIncomplete: false, coverageLabel: "нет доступа" });
    out.hidden!.push("contracts");
    out.flags = out.flags.filter((f) => !CONTRACT_FLAGS.includes(f.code));
  }
  if (!v.acts) {
    Object.assign(out, { actsAccepted: null, actsPending: null, documentedPercent: null, earnedVsActs: null });
    out.hidden!.push("acts");
    out.flags = out.flags.filter((f) => !ACT_FLAGS.includes(f.code));
  }
  // Уровень строки пересчитывается по оставшимся замечаниям, чтобы статус не раскрывал скрытые данные
  out.level = rowLevel(out.flags);
  out.levelLabel = LEVEL_LABELS[out.level];
  return out;
}

/**
 * Фильтры реестра по закрытым данным игнорируются: иначе по составу отфильтрованных строк
 * можно было бы восстановить скрытую информацию (например, какие статьи покрыты договором).
 */
export function stripHiddenFilters<T extends { contractor?: string; contract?: string; coverage?: string; acts?: string; deviation?: string }>(f: T, v: Visibility): T {
  const out = { ...f };
  if (!v.contracts) {
    delete out.contractor;
    delete out.contract;
    delete out.coverage;
  }
  if (!v.acts) delete out.acts;
  if (!v.accounting || !v.contracts || !v.acts) delete out.deviation;
  return out;
}

/** Столбцы реестра, требующие прав. */
export const COLUMN_SCOPE: Record<string, keyof Visibility> = {
  accountingCost: "accounting",
  variance: "accounting",
  forecast: "accounting",
  paid: "accounting",
  contractor: "contracts",
  contractNumber: "contracts",
  contractDate: "contracts",
  contractAmount: "contracts",
  coverage: "contracts",
  actsAccepted: "acts",
  documentedPercent: "acts",
};

export function requiredFor(scope: keyof Visibility): Permission {
  return scope === "accounting" ? "accounting.view" : scope === "contracts" ? "contract.view" : "act.view";
}
