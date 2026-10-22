import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseTabular, parseNumberCell, parseCsv } from "@/lib/import/tabular";
import { buildEstimatePreview, guessEstimateMapping, diffVersions, splitSection } from "@/lib/import/estimate";
import iconv from "iconv-lite";

async function makeXlsx(rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Смета");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const SAMPLE: (string | number | null)[][] = [
  ["ЛОКАЛЬНЫЙ СМЕТНЫЙ РАСЧЁТ № 02-01-01"],
  ["Объект: Жилой комплекс (ТЕСТ)"],
  [],
  ["№ п/п", "Шифр расценки", "Наименование работ", "Ед. изм.", "Количество", "Цена за ед., сом", "Стоимость, сом"],
  [1, 2, 3, 4, 5, 6, 7],
  ["Раздел 1. Земляные работы"],
  [1, "ГЭСН01-01-003", "Разработка грунта экскаватором", "м3", 1200, 350, 420000],
  [2, "ГЭСН01-02-001", "Обратная засыпка", "м3", "400,5", "120", null],
  ["Итого по разделу 1", null, null, null, null, null, 468060],
  ["Раздел 2. Бетонные работы"],
  [3, "ГЭСН06-01-001", "Бетонирование фундаментной плиты", "м3", 300, 9500, 2860000],
  [4, null, "Устройство гидроизоляции", "м2", null, null, 150000],
  [5, "ГЭСН06-01-001", "Бетонирование фундаментной плиты", "м3", 10, 9500, 95000],
  ["Всего по смете", null, null, null, null, null, 3573060],
];

describe("Разбор чисел", () => {
  it.each([
    ["1 234,56", "1234.56"],
    ["1234.56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["(150,00)", "-150.00"],
    ["−12", "-12"],
    ["", null],
    ["-", null],
  ])("%s → %s", (input, expected) => {
    const r = parseNumberCell(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(expected);
  });
  it("текст не превращается в число", () => {
    expect(parseNumberCell("по факту").ok).toBe(false);
  });
  it("double из Excel без артефактов", () => {
    const r = parseNumberCell(0.1 + 0.2);
    expect(r.ok && r.value).toBe("0.3");
  });
});

describe("Импорт сметы из XLSX", () => {
  it("определяет заголовки, разделы, итоговые строки и проверяет данные", async () => {
    const sheets = await parseTabular(await makeXlsx(SAMPLE), "smeta.xlsx");
    const mapping = guessEstimateMapping(sheets);
    expect(mapping.headerRow).toBe(4);
    expect(mapping.columns).toMatchObject({ lineNo: 0, code: 1, name: 2, unit: 3, quantity: 4, unitPrice: 5, total: 6 });
    expect(mapping.sectionMode).toBe("header-rows");

    const p = buildEstimatePreview(sheets, mapping);
    expect(p.mappingErrors).toEqual([]);
    expect(p.lines).toHaveLength(5);
    expect(p.sections).toEqual([
      { code: "1", name: "Земляные работы" },
      { code: "2", name: "Бетонные работы" },
    ]);
    const [l1, l2, l3, l4, l5] = p.lines;
    expect(l1).toMatchObject({ rowNumber: 7, quantity: "1200", unitPrice: "350", total: "420000", plannedCost: "420000.00", sectionCode: "1" });
    // итог отсутствует → объём × цена
    expect(l2).toMatchObject({ quantity: "400.5", plannedCost: "48060.00" });
    // итог 2 860 000 ≠ 300 × 9 500 = 2 850 000 → предупреждение, но исходный итог сохраняется
    expect(l3.plannedCost).toBe("2860000.00");
    expect(l3.issues.some((i) => i.level === "warning" && /отличается/.test(i.message))).toBe(true);
    // без объёма — предупреждение
    expect(l4.issues.some((i) => /объём/.test(i.message))).toBe(true);
    // одинаковый код и наименование в одном разделе → дубликат ключа → ошибка
    expect(l5.issues.some((i) => i.level === "error" && /повторяется/.test(i.message))).toBe(true);
    expect(l3.issues.some((i) => i.level === "error")).toBe(true);
    expect(p.errorCount).toBe(2);
    expect(p.totalPlanned).toBe("3573060.00");
    expect(p.fileTotals.map((t) => t.value)).toEqual(["468060", "3573060"]);
    expect(p.skipped.some((s) => /нумерация/.test(s.reason))).toBe(true);
  });

  it("режим ключа по № п/п устраняет дубликаты", async () => {
    const sheets = await parseTabular(await makeXlsx(SAMPLE), "smeta.xlsx");
    const p = buildEstimatePreview(sheets, { ...guessEstimateMapping(sheets), keyMode: "lineNo" });
    expect(p.errorCount).toBe(0);
  });

  it("ошибка сопоставления без столбца наименования", async () => {
    const sheets = await parseTabular(await makeXlsx(SAMPLE), "smeta.xlsx");
    const m = guessEstimateMapping(sheets);
    const p = buildEstimatePreview(sheets, { ...m, columns: { ...m.columns, name: undefined } });
    expect(p.mappingErrors.length).toBeGreaterThan(0);
    expect(p.lines).toHaveLength(0);
  });

  it(".xls отклоняется с понятной причиной", async () => {
    await expect(parseTabular(Buffer.from("x"), "old.xls")).rejects.toThrow(/xlsx/i);
  });
});

describe("CSV", () => {
  it("cp1251 и разделитель ;", () => {
    const buf = iconv.encode('Наименование;Количество;Стоимость\r\n"Кладка; стен";10;"1 000,50"\r\n', "win1251");
    const s = parseCsv(buf);
    expect(s.rows[0]).toEqual(["Наименование", "Количество", "Стоимость"]);
    expect(s.rows[1]).toEqual(["Кладка; стен", "10", "1 000,50"]);
  });
});

describe("Разделы", () => {
  it.each([
    ["Раздел 3. Кровля", "3", "Кровля"],
    ["РАЗДЕЛ 4: Фасад", "4", "Фасад"],
    ["2.1 Окна", "2.1", "Окна"],
  ])("%s", (t, code, name) => {
    expect(splitSection(t)).toEqual({ code, name });
  });
});

describe("Сравнение версий", () => {
  it("добавленные, удалённые, изменённые статьи и изменение итога", () => {
    const v1 = [
      { itemKey: "a", code: "1", name: "Кладка", unit: "м3", quantity: "10", unitPrice: "100", plannedCost: "1000" },
      { itemKey: "b", code: "2", name: "Штукатурка", unit: "м2", quantity: "50", unitPrice: "10", plannedCost: "500" },
      { itemKey: "c", code: "3", name: "Окраска", unit: "м2", quantity: "50", unitPrice: "5", plannedCost: "250" },
    ];
    const v2 = [
      { itemKey: "a", code: "1", name: "Кладка", unit: "м3", quantity: "12", unitPrice: "100", plannedCost: "1200" },
      { itemKey: "b", code: "2", name: "Штукатурка", unit: "м2", quantity: "50.000", unitPrice: "10", plannedCost: "500.00" },
      { itemKey: "d", code: "4", name: "Плитка", unit: "м2", quantity: "20", unitPrice: "40", plannedCost: "800" },
    ];
    const d = diffVersions(v1, v2);
    expect([d.added, d.removed, d.changed, d.unchanged]).toEqual([1, 1, 1, 1]);
    expect(d.rows.find((r) => r.itemKey === "a")!.changes).toEqual(["quantity", "plannedCost"]);
    expect(d.totalBefore).toBe("1750.00");
    expect(d.totalAfter).toBe("2500.00");
    expect(d.totalDelta).toBe("750.00");
  });
});
