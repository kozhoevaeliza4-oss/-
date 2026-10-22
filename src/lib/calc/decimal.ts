import Decimal from "decimal.js";

// Точная десятичная арифметика для денег, объёмов и процентов.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** null — «нет данных». Никогда не подменяется нулём. */
export type Num = Decimal | null;

type DecInput = Decimal | string | number | bigint | { toString(): string } | null | undefined;

/** Преобразование значения из БД/ввода в Decimal. Пустые значения → null. */
export function dec(value: DecInput): Num {
  if (value === null || value === undefined) return null;
  if (Decimal.isDecimal(value)) return value as Decimal;
  const s = String(value).trim();
  if (s === "") return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export const ZERO = new Decimal(0);
export const HUNDRED = new Decimal(100);

/** Сумма известных значений. Если известных нет — null. missing — число неизвестных слагаемых. */
export function sumKnown(values: Num[]): { sum: Num; missing: number; known: number } {
  let sum: Decimal | null = null;
  let missing = 0;
  let known = 0;
  for (const v of values) {
    if (v === null) {
      missing++;
      continue;
    }
    known++;
    sum = sum === null ? v : sum.plus(v);
  }
  return { sum, missing, known };
}

export function sub(a: Num, b: Num): Num {
  return a === null || b === null ? null : a.minus(b);
}

export function mul(a: Num, b: Num): Num {
  return a === null || b === null ? null : a.times(b);
}

/** Деление без деления на ноль: при нулевом/отсутствующем делителе — null. */
export function safeDiv(a: Num, b: Num): Num {
  if (a === null || b === null || b.isZero()) return null;
  return a.div(b);
}

/** Процент a от b. При нулевой/отсутствующей базе — null («Нет данных для расчёта»). */
export function percentOf(a: Num, b: Num): Num {
  const r = safeDiv(a, b);
  return r === null ? null : r.times(HUNDRED);
}

export function money(v: Num): Num {
  return v === null ? null : v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function clamp(v: Decimal, min: Decimal, max: Decimal): Decimal {
  return Decimal.max(min, Decimal.min(max, v));
}
