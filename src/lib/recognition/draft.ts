/**
 * Структура черновика распознанного АВР (хранится в ActRecognition как JSON) и общие функции.
 * Используется и на сервере, и в интерфейсе проверки.
 */
import type { ActFieldKey, LineColumn, RecCell, RecField } from "@/lib/extract/act";
import type { ArithmeticCheck } from "@/lib/calc/actChecks";
import type { ContractMatch, LineMatch } from "@/lib/extract/match";
import type { BBox } from "@/lib/extract/ocrTypes";

export interface DraftAllocation {
  workItemId: string;
  label: string;
  quantity: string | null;
  amount: string | null;
  /** Сопоставление подтверждено пользователем */
  confirmed: boolean;
}

export interface DraftCell extends RecCell {
  /** Значение до правки пользователем (исходное распознанное) */
  original?: string | null;
  edited?: boolean;
}

export interface DraftLine {
  key: string;
  page: number | null;
  bbox: BBox | null;
  section: string | null;
  cells: Record<LineColumn, DraftCell>;
  /** Строка проверена пользователем (все значения сверены с оригиналом) */
  verified: boolean;
  /** Добавлена пользователем вручную */
  manual?: boolean;
  allocations: DraftAllocation[];
  match: LineMatch | null;
  /** Не найдено соответствие — оставить для решения ответственного */
  unmatchedAccepted: boolean;
}

export interface DraftField extends RecField {
  original?: string | null;
}

export type DraftFields = Record<ActFieldKey, DraftField>;

export interface DraftMatches {
  contract: ContractMatch | null;
  selectedContractId: string | null;
  selectedContractorId: string | null;
}

export interface DraftChecks {
  arithmetic: ArithmeticCheck[];
  warnings: string[];
  hasCharges: boolean;
  preprocessing: string[];
}

export const NUMERIC_COLUMNS: LineColumn[] = ["quantity", "unitPrice", "amount"];

/** Поля, которые должны быть заполнены и проверены для подтверждения акта */
export const REQUIRED_FIELDS: ActFieldKey[] = ["number", "date"];

export interface ConfirmBlocker {
  code: string;
  text: string;
}

/** Что мешает подтвердить черновик (только проверка полноты и подтверждений — финансовые проверки отдельно). */
export function confirmBlockers(fields: DraftFields, lines: DraftLine[], opts: { duplicatesFound: boolean; duplicateDecision: string | null }): ConfirmBlocker[] {
  const b: ConfirmBlocker[] = [];
  for (const k of REQUIRED_FIELDS) if (!fields[k]?.value) b.push({ code: `MISSING_${k}`, text: `Не заполнено поле «${k === "number" ? "Номер акта" : "Дата составления"}»` });
  const low = (Object.entries(fields) as [ActFieldKey, DraftField][]).filter(([, f]) => f.status === "low_confidence" && f.value);
  if (low.length) b.push({ code: "LOW_CONFIDENCE_FIELDS", text: `Подтвердите или исправьте значения с низкой уверенностью: ${low.length}` });
  if (!lines.length) b.push({ code: "NO_LINES", text: "Нет ни одной строки работ" });
  lines.forEach((l, i) => {
    if (!l.cells.name.value) b.push({ code: "LINE_NO_NAME", text: `Строка ${i + 1}: нет наименования` });
    if (!l.cells.amount.value) b.push({ code: "LINE_NO_AMOUNT", text: `Строка ${i + 1}: нет суммы` });
    if (!l.verified) b.push({ code: "LINE_NOT_VERIFIED", text: `Строка ${i + 1}: не отмечена как проверенная` });
    if (l.allocations.some((a) => !a.confirmed)) b.push({ code: "ALLOCATION_NOT_CONFIRMED", text: `Строка ${i + 1}: сопоставление со статьёй не подтверждено` });
    if (!l.allocations.length && !l.unmatchedAccepted)
      b.push({ code: "LINE_UNMATCHED", text: `Строка ${i + 1}: не найдено соответствие — выберите статью или оставьте строку для решения ответственного` });
  });
  if (opts.duplicatesFound && !opts.duplicateDecision?.trim()) b.push({ code: "DUPLICATE", text: "Найден возможный дубликат — откройте его или подтвердите, что это другой документ" });
  return b;
}
