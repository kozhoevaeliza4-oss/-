import { z } from "zod";
import { dec } from "@/lib/calc/decimal";

/**
 * Разбор числа, введённого пользователем: «1 234 567,89», «1234567.89», «-500».
 * Экспоненциальная и шестнадцатеричная запись (1e99, 0x10) не принимаются — decimal.js понимает их,
 * а пользователь так суммы не пишет. Ограничение разрядов соответствует колонкам Decimal(18, dp).
 */
export function parseUserDecimal(raw: string | number, opts: { dp: number; allowNegative?: boolean }): { value: string } | { error: "format" | "negative" | "range" } {
  const s = String(raw).replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { error: "format" };
  const d = dec(s);
  if (d === null) return { error: "format" };
  if (d.isNegative() && !d.isZero() && !opts.allowNegative) return { error: "negative" };
  if (d.abs().gte(Decimal10(18 - opts.dp))) return { error: "range" };
  return { value: d.toFixed(opts.dp) };
}

function Decimal10(digits: number) {
  return dec("1" + "0".repeat(digits))!;
}

/** Необязательное числовое поле формы (пустое значение = нет данных, а не ноль). */
export function decimalField(label: string, dp: number, opts: { allowNegative?: boolean } = {}) {
  return z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || String(v).trim() === "") return null;
      const r = parseUserDecimal(v, { dp, allowNegative: opts.allowNegative });
      if ("value" in r) return r.value;
      ctx.addIssue({
        code: "custom",
        message: r.error === "negative" ? `${label}: значение не может быть отрицательным` : r.error === "range" ? `${label}: слишком большое значение` : `${label}: введите число (например, 1 250 000,50)`,
      });
      return z.NEVER;
    });
}
