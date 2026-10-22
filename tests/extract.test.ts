import { describe, expect, it } from "vitest";
import { docNumberKey, normalizeNumber, parseAmountInWords, parseDocDate } from "@/lib/extract/normalize";
import { extractContractFields } from "@/lib/extract/contract";

describe("Нормализация чисел из OCR", () => {
  it.each([
    ["1 234,56", "1234.56", false],
    ["12О 000", "120000", true], // кириллическая О
    ["1O5,5", "105.5", true],
    ["l 250", "1250", true],
    ["-1 500,00", "-1500.00", false],
  ])("%s → %s", (raw, value, corrected) => {
    const r = normalizeNumber(raw);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(value);
    expect(r.corrected).toBe(corrected);
  });
  it("слово не превращается в число", () => {
    expect(normalizeNumber("Отделка").ok).toBe(false);
    expect(normalizeNumber("м2").ok).toBe(false);
  });
});

describe("Даты", () => {
  it.each([
    ["от 12.03.2026 г.", "2026-03-12"],
    ["«5» октября 2026 г.", "2026-10-05"],
    ["01/02/26", "2026-02-01"],
    ["31.02.2026", null],
    ["12 бештин айы 2026", "2026-12-12"],
  ])("%s", (t, v) => expect(parseDocDate(t)).toBe(v));
});

describe("Номера документов", () => {
  it("кириллица/латиница, пробелы и № не влияют на сравнение", () => {
    expect(docNumberKey("№ Д-02/26")).toBe(docNumberKey("D-02/26".replace("D", "Д")));
    expect(docNumberKey("АВР-7")).toBe(docNumberKey("ABP-7"));
    expect(docNumberKey("15 /O1")).toBe(docNumberKey("15/01"));
  });
});

describe("Сумма прописью", () => {
  it.each([
    ["Один миллион двести тысяч сом 50 тыйын", "1200000.50"],
    ["Пять тысяч сто двадцать три сома 00 тыйын", "5123.00"],
    ["Двести сорок семь тысяч девятьсот сом", "247900.00"],
  ])("%s", (t, v) => expect(parseAmountInWords(t)).toBe(v));
  it("неразборчивый текст — null", () => expect(parseAmountInWords("сумма неразборчива")).toBeNull());
});

describe("Реквизиты договора", () => {
  const text = `ДОГОВОР ПОДРЯДА № 15/26 от 12 марта 2026 г.
г. Бишкек
ОсОО «Заказчик-Строй», именуемое в дальнейшем «Заказчик», и ОсОО «Тест-Монолит», именуемое в дальнейшем «Подрядчик», заключили настоящий договор.
1. ПРЕДМЕТ ДОГОВОРА
1.1. Подрядчик обязуется выполнить монолитные работы на объекте: «Жилой дом, корпус 1» в соответствии со сметой.
2. СТОИМОСТЬ РАБОТ
2.1. Общая стоимость работ по договору составляет 12 500 000,00 (двенадцать миллионов пятьсот тысяч) сом.
3. СРОКИ
Начало работ: 01.04.2026. Окончание работ: 30.11.2026.
4. ПОРЯДОК ОПЛАТЫ
4.1. Аванс 30% в течение 10 банковских дней после подписания договора.
РЕКВИЗИТЫ
Подрядчик: ОсОО «Тест-Монолит» ИНН 01234567891011`;
  const fields = Object.fromEntries(extractContractFields([{ page: 1, label: "стр. 1", text }]).map((f) => [f.field, f]));

  it("извлекает реквизиты с источником", () => {
    expect(fields.number.value).toBe("15/26");
    expect(fields.date.value).toBe("2026-03-12");
    expect(fields.contractorName.value).toBe("ОсОО «Тест-Монолит»");
    expect(fields.contractorInn.value).toBe("01234567891011");
    expect(fields.totalAmount.value).toBe("12500000.00");
    expect(fields.currency.value).toBe("KGS");
    expect(fields.startDate.value).toBe("2026-04-01");
    expect(fields.endDate.value).toBe("2026-11-30");
    expect(fields.objectText.value).toBe("Жилой дом, корпус 1");
    expect(fields.paymentTerms.value).toMatch(/Аванс 30%/);
    expect(fields.number.page).toBe(1);
    expect(fields.totalAmount.fragment).toMatch(/12 500 000/);
  });

  it("отсутствующие поля не выдумываются", () => {
    const f = extractContractFields([{ page: 1, label: "стр. 1", text: "Договор без реквизитов. Просто текст." }]);
    expect(f.find((x) => x.field === "totalAmount")).toBeUndefined();
    expect(f.find((x) => x.field === "date")).toBeUndefined();
  });
});
