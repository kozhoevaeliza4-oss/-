/** Регрессия QA-11: разбор денежных и объёмных полей, введённых пользователем. */
import { describe, expect, it } from "vitest";
import { decimalField, parseUserDecimal } from "@/lib/server/decimalField";

describe("parseUserDecimal", () => {
  it("принимает обычную запись с пробелами и запятой", () => {
    expect(parseUserDecimal("1 250 000,5", { dp: 2 })).toEqual({ value: "1250000.50" });
    expect(parseUserDecimal("1 000", { dp: 2 })).toEqual({ value: "1000.00" });
    expect(parseUserDecimal(0, { dp: 2 })).toEqual({ value: "0.00" });
  });
  it("отклоняет экспоненту, hex, бесконечность и мусор", () => {
    for (const v of ["1e99", "0x10", "Infinity", "NaN", "12abc", "1,2,3", "--5", ""]) expect(parseUserDecimal(v, { dp: 2 }), v).toEqual({ error: "format" });
  });
  it("отрицательные — только где разрешено", () => {
    expect(parseUserDecimal("-5000", { dp: 2 })).toEqual({ error: "negative" });
    expect(parseUserDecimal("-5000", { dp: 2, allowNegative: true })).toEqual({ value: "-5000.00" });
    expect(parseUserDecimal("-0", { dp: 2 })).toEqual({ value: "0.00" });
  });
  it("ограничение по разрядности колонки Decimal(18, dp)", () => {
    expect(parseUserDecimal("9999999999999999.99", { dp: 2 })).toEqual({ value: "9999999999999999.99" });
    expect(parseUserDecimal("10000000000000000", { dp: 2 })).toEqual({ error: "range" });
    expect(parseUserDecimal("100000000000000", { dp: 4 })).toEqual({ error: "range" });
  });
  it("пустое поле — нет данных (null), а не ноль", () => {
    expect(decimalField("Сумма", 2).parse("")).toBeNull();
    expect(decimalField("Сумма", 2).parse(undefined)).toBeNull();
    expect(() => decimalField("Сумма", 2).parse("-1")).toThrow(/не может быть отрицательным/);
  });
});
