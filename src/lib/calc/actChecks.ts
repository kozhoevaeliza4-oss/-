/**
 * Арифметические проверки акта: строки (кол-во × цена), сумма строк, НДС, итог, сумма прописью.
 * Расхождение — предупреждение для проверки, исходные значения не исправляются.
 */
import { Decimal, Num, dec, sumKnown } from "./decimal";

/** Допуск округления, в валюте документа */
export const ROUNDING_TOLERANCE = new Decimal("1.00");

export interface CheckLineInput {
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
}

export type CheckLevel = "ok" | "warning" | "info" | "error";

export interface ArithmeticCheck {
  code: string;
  level: CheckLevel;
  message: string;
  documentValue: string | null;
  computedValue: string | null;
  difference: string | null;
  lineIndexes: number[];
}

const s = (v: Num) => (v === null ? null : v.toFixed(2));

export function checkActArithmetic(input: {
  lines: CheckLineInput[];
  subtotal: string | null;
  vatAmount: string | null;
  total: string | null;
  amountInWords: string | null;
  /** В документе есть начисления между строками и итогом (накладные, коэффициенты) */
  hasCharges: boolean;
}): ArithmeticCheck[] {
  const checks: ArithmeticCheck[] = [];

  // 1. Строки
  const badLines: number[] = [];
  input.lines.forEach((l, i) => {
    const q = dec(l.quantity);
    const p = dec(l.unitPrice);
    const a = dec(l.amount);
    if (q === null || p === null || a === null) return;
    const diff = a.minus(q.times(p));
    if (diff.abs().gt(ROUNDING_TOLERANCE)) {
      badLines.push(i);
      checks.push({
        code: "LINE_MISMATCH",
        level: "warning",
        message: `Строка ${i + 1}: количество × цена = ${q.times(p).toFixed(2)}, в документе ${a.toFixed(2)}`,
        documentValue: a.toFixed(2),
        computedValue: q.times(p).toFixed(2),
        difference: diff.toFixed(2),
        lineIndexes: [i],
      });
    }
  });
  const incomplete = input.lines.map((l, i) => (l.amount === null ? i : -1)).filter((i) => i >= 0);
  if (incomplete.length)
    checks.push({ code: "LINE_NO_AMOUNT", level: "warning", message: `Нет суммы в строках: ${incomplete.map((i) => i + 1).join(", ")}`, documentValue: null, computedValue: null, difference: null, lineIndexes: incomplete });
  if (input.lines.length && !badLines.length && !incomplete.length)
    checks.push({ code: "LINES_OK", level: "ok", message: "Суммы всех строк соответствуют количеству × цене (с учётом округления)", documentValue: null, computedValue: null, difference: null, lineIndexes: [] });

  // 2. Сумма строк vs итог
  const linesSum = sumKnown(input.lines.map((l) => dec(l.amount))).sum;
  const subtotal = dec(input.subtotal);
  const total = dec(input.total);
  const vat = dec(input.vatAmount);
  const compareTo = subtotal ?? (vat === null ? total : null);
  if (linesSum !== null && compareTo !== null) {
    const diff = compareTo.minus(linesSum);
    if (diff.abs().gt(ROUNDING_TOLERANCE)) {
      checks.push({
        code: "SUBTOTAL_MISMATCH",
        level: input.hasCharges ? "info" : "warning",
        message: input.hasCharges
          ? "Итог документа отличается от суммы строк; документ содержит начисления (накладные, коэффициенты) — расхождение не считается ошибкой автоматически"
          : "Сумма строк не совпадает с итогом документа",
        documentValue: s(compareTo),
        computedValue: s(linesSum),
        difference: s(diff),
        lineIndexes: [],
      });
    } else {
      checks.push({ code: "SUBTOTAL_OK", level: "ok", message: "Сумма строк совпадает с итогом документа", documentValue: s(compareTo), computedValue: s(linesSum), difference: s(diff), lineIndexes: [] });
    }
  } else if (linesSum !== null && compareTo === null && total === null) {
    checks.push({ code: "NO_TOTAL", level: "warning", message: "Итоговая сумма в документе не распознана", documentValue: null, computedValue: s(linesSum), difference: null, lineIndexes: [] });
  }

  // 3. НДС и итог
  if (vat !== null && total !== null) {
    const base = subtotal ?? linesSum;
    if (base !== null) {
      const diff = total.minus(base.plus(vat));
      const rate = base.isZero() ? null : vat.div(base).times(100);
      checks.push({
        code: diff.abs().gt(ROUNDING_TOLERANCE) ? "VAT_TOTAL_MISMATCH" : "VAT_TOTAL_OK",
        level: diff.abs().gt(ROUNDING_TOLERANCE) ? (input.hasCharges ? "info" : "warning") : "ok",
        message: diff.abs().gt(ROUNDING_TOLERANCE)
          ? `Итог ≠ сумма без НДС + НДС${rate ? ` (ставка по документу ≈ ${rate.toFixed(1)} %)` : ""}`
          : `Итог = сумма без НДС + НДС${rate ? ` (ставка ≈ ${rate.toFixed(1)} %)` : ""}`,
        documentValue: s(total),
        computedValue: s(base.plus(vat)),
        difference: s(diff),
        lineIndexes: [],
      });
    }
  }

  // 4. Сумма прописью
  const words = dec(input.amountInWords);
  if (words !== null && total !== null) {
    const diff = total.minus(words);
    checks.push({
      code: diff.abs().gt(ROUNDING_TOLERANCE) ? "WORDS_MISMATCH" : "WORDS_OK",
      level: diff.abs().gt(ROUNDING_TOLERANCE) ? "warning" : "ok",
      message: diff.abs().gt(ROUNDING_TOLERANCE) ? "Сумма прописью не совпадает с итогом цифрами" : "Сумма прописью совпадает с итогом",
      documentValue: s(total),
      computedValue: s(words),
      difference: s(diff),
      lineIndexes: [],
    });
  }
  return checks;
}
