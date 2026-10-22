/**
 * Правила признания (единые для реестра, панели, отчётов и расшифровок).
 */
import type { ActStatus } from "./workItem";

/** Категории операций 1С, которые входят в затраты статьи (с исходным знаком суммы) после подтверждения классификации. */
export const COST_CATEGORIES = ["COST", "ADJUSTMENT", "REVERSAL"] as const;

export function isCostTransaction(t: { category: string; classification: string }): boolean {
  return t.classification === "CONFIRMED" && (COST_CATEGORIES as readonly string[]).includes(t.category);
}

export interface ActStatusInput {
  status: string;
  /** Дата документа */
  date: Date;
  signedAt: Date | null;
  annulledAt: Date | null;
  correctedAt: Date | null;
}

/**
 * Статус акта для расчёта. Без даты — текущий статус: CORRECTED/ANNULLED/REJECTED в расчёт не входят.
 * На дату asOf: подписан, если signedAt ≤ asOf и акт не был аннулирован/заменён к этой дате;
 * существовал, но не был подписан — «на согласовании»; не существовал — исключается (null).
 */
export function effectiveActStatus(a: ActStatusInput, asOf?: Date | null): ActStatus | null {
  if (!asOf) {
    if (a.status === "SIGNED" || a.status === "DRAFT" || a.status === "ON_APPROVAL" || a.status === "REJECTED") return a.status;
    return null; // CORRECTED, ANNULLED
  }
  if (a.date > asOf) return null;
  const gone = (d: Date | null) => d !== null && d <= asOf;
  if (a.signedAt && a.signedAt <= asOf) return gone(a.annulledAt) || gone(a.correctedAt) ? null : "SIGNED";
  if (gone(a.annulledAt)) return null;
  return a.status === "REJECTED" ? "REJECTED" : "ON_APPROVAL";
}

/** Конец дня в UTC для фильтра «на дату». */
export function endOfDayUTC(isoDate: string): Date {
  return new Date(isoDate + "T23:59:59.999Z");
}
