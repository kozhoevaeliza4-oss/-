/**
 * Предварительное сопоставление распознанных строк и реквизитов с данными проекта.
 * Только предложения: итоговое решение принимает пользователь.
 */
import { docNumberKey } from "./normalize";

export type MatchLevel = "high" | "medium" | "low";

const STOP = new Set(["и", "в", "на", "с", "по", "из", "для", "до", "от", "под", "над", "при", "к", "о", "об", "а", "со", "во"]);

export function nameTokens(s: string | null | undefined): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-яүөң0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t))
    .map((t) => (/^\d+$/.test(t) ? t : t.slice(0, 6)));
}

/** Коэффициент Дайса по основам слов (0–1). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Map<string, number>();
  for (const t of tb) setB.set(t, (setB.get(t) ?? 0) + 1);
  let inter = 0;
  for (const t of ta) {
    const n = setB.get(t) ?? 0;
    if (n > 0) {
      inter++;
      setB.set(t, n - 1);
    }
  }
  return (2 * inter) / (ta.length + tb.length);
}

export function normUnit(u: string | null | undefined): string {
  return String(u ?? "")
    .toLowerCase()
    .replace(/\s|\./g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/^кв\.?м$|^мкв$/, "м2")
    .replace(/^куб\.?м$|^мкуб$/, "м3")
    .replace(/^шт.*$/, "шт")
    .replace(/^компл.*$/, "компл")
    .replace(/^т(онн.*)?$/, "т");
}

export interface ItemCandidate {
  id: string;
  code: string | null;
  name: string;
  unit: string | null;
  objectCode: string | null;
  /** Плановая цена за единицу (смета) */
  plannedPrice: string | null;
  /** Статья распределена на найденный договор */
  inContract: boolean;
  contractPrice: string | null;
}

export interface ItemSuggestion {
  workItemId: string;
  label: string;
  score: number;
  reasons: string[];
}

export interface LineMatch {
  level: MatchLevel;
  suggestions: ItemSuggestion[];
}

export function matchLine(
  line: { code: string | null; name: string | null; unit: string | null; unitPrice: string | null },
  candidates: ItemCandidate[],
  opts: { objectHint?: string | null } = {},
): LineMatch {
  const scored: ItemSuggestion[] = [];
  const code = line.code ? line.code.toUpperCase().replace(/\s/g, "") : null;
  const price = line.unitPrice ? Number(line.unitPrice) : null;
  for (const c of candidates) {
    const reasons: string[] = [];
    let score = 0;
    if (code && c.code && c.code.toUpperCase().replace(/\s/g, "") === code) {
      score += 0.45;
      reasons.push("совпадает код");
    }
    const sim = nameSimilarity(line.name, c.name);
    if (sim > 0) {
      score += 0.4 * sim;
      if (sim >= 0.5) reasons.push(`наименование ${Math.round(sim * 100)} %`);
    }
    if (line.unit && c.unit) {
      if (normUnit(line.unit) === normUnit(c.unit)) {
        score += 0.07;
        reasons.push("ед. изм.");
      } else score -= 0.1;
    }
    if (c.inContract) {
      score += 0.1;
      reasons.push("в договоре");
    }
    const ref = c.contractPrice ?? c.plannedPrice;
    if (price && ref && Number(ref) > 0 && Math.abs(price - Number(ref)) / Number(ref) <= 0.1) {
      score += 0.05;
      reasons.push("цена близка");
    }
    if (opts.objectHint && c.objectCode && opts.objectHint.toLowerCase().includes(c.objectCode.toLowerCase())) {
      score += 0.03;
      reasons.push("корпус");
    }
    if (score > 0.2) scored.push({ workItemId: c.id, label: `${c.code ? c.code + " — " : ""}${c.name}${c.objectCode ? ` (${c.objectCode})` : ""}`, score: Math.min(1, score), reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);
  const best = top[0]?.score ?? 0;
  const second = top[1]?.score ?? 0;
  const level: MatchLevel = best >= 0.7 && best - second >= 0.1 ? "high" : best >= 0.4 ? "medium" : "low";
  return { level, suggestions: level === "low" ? top.slice(0, 3) : top };
}

export interface ContractCandidate {
  id: string;
  number: string | null;
  date: string | null;
  contractorId: string | null;
  contractorName: string | null;
  contractorInn: string | null;
  status: string;
}

export interface ContractMatch {
  level: MatchLevel;
  suggestions: { contractId: string; label: string; reasons: string[] }[];
  contractorId: string | null;
  contractorLevel: MatchLevel;
}

export function matchContract(
  doc: { contractNumber: string | null; contractDate: string | null; contractorName: string | null; contractorInn: string | null },
  contracts: ContractCandidate[],
  contractors: { id: string; name: string; inn: string | null }[],
): ContractMatch {
  // Подрядчик
  let contractorId: string | null = null;
  let contractorLevel: MatchLevel = "low";
  if (doc.contractorInn) {
    const c = contractors.find((x) => x.inn === doc.contractorInn);
    if (c) {
      contractorId = c.id;
      contractorLevel = "high";
    }
  }
  if (!contractorId && doc.contractorName) {
    const ranked = contractors.map((c) => ({ c, sim: nameSimilarity(doc.contractorName, c.name) })).sort((a, b) => b.sim - a.sim);
    if (ranked[0] && ranked[0].sim >= 0.6) {
      contractorId = ranked[0].c.id;
      contractorLevel = ranked[0].sim >= 0.85 && (ranked[1]?.sim ?? 0) < 0.6 ? "high" : "medium";
    }
  }
  // Договор
  const key = docNumberKey(doc.contractNumber);
  const live = contracts.filter((c) => c.status !== "TERMINATED");
  const byNumber = key ? live.filter((c) => docNumberKey(c.number) === key) : [];
  const label = (c: ContractCandidate) => `№ ${c.number ?? "—"}${c.date ? ` от ${c.date}` : ""}${c.contractorName ? ` · ${c.contractorName}` : ""}`;
  if (byNumber.length === 1) {
    const c = byNumber[0];
    const reasons = ["совпадает номер договора"];
    if (doc.contractDate && c.date === doc.contractDate) reasons.push("совпадает дата");
    if (contractorId && c.contractorId === contractorId) reasons.push("совпадает подрядчик");
    const level: MatchLevel = contractorId && c.contractorId && c.contractorId !== contractorId ? "medium" : "high";
    return { level, suggestions: [{ contractId: c.id, label: label(c), reasons }], contractorId: contractorId ?? c.contractorId, contractorLevel: contractorId ? contractorLevel : "medium" };
  }
  const pool = byNumber.length > 1 ? byNumber : contractorId ? live.filter((c) => c.contractorId === contractorId) : [];
  if (pool.length) {
    return {
      level: "medium",
      suggestions: pool.slice(0, 5).map((c) => ({ contractId: c.id, label: label(c), reasons: [byNumber.length > 1 ? "совпадает номер" : "договор того же подрядчика"] })),
      contractorId,
      contractorLevel,
    };
  }
  return { level: "low", suggestions: [], contractorId, contractorLevel };
}
