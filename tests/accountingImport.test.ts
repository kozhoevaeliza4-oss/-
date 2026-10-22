import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { parseCsv } from "@/lib/import/tabular";
import { buildAccountingPreview, guessAccountingMapping, matchRule, RuleInput } from "@/lib/import/accounting";

const CSV = [
  "Карточка счета 1636 за октябрь 2026 (ТЕСТОВЫЕ ДАННЫЕ)",
  "Период;Документ;Счет Дт;Счет Кт;Сумма;Контрагент;Объект строительства;Статья затрат;Содержание",
  "01.10.2026;Поступление услуг 00012;1636;3110;150 000,00;ОсОО Тест-Монолит;Корпус 1;Монолитные работы;Колонны, акт 15",
  "05.10.2026;Поступление материалов 00031;1636;3110;48 000,00;ОсОО Бетон;Корпус 1;Материалы;Бетон В25",
  "05.10.2026;Поступление материалов 00031;1636;3110;48 000,00;ОсОО Бетон;Корпус 1;Материалы;Бетон В25",
  "10.10.2026;Перемещение 0004;1637;1636;-20 000,00;;;;Внутреннее перемещение",
  "12.10.2026;Операция 77;1636;3110;5 000,00;;;;",
  "abc;Ошибка;1636;3110;xx;;;;",
  "Обороты за период;;;;183 000,00;;;;",
].join("\r\n");

const sheets = () => [parseCsv(iconv.encode(CSV, "win1251"))];

describe("Импорт 1С", () => {
  it("определяет столбцы и разбирает строки", () => {
    const m = guessAccountingMapping(sheets());
    expect(m.headerRow).toBe(2);
    expect(m.columns).toMatchObject({ date: 0, documentNumber: 1, account: 2, corrAccount: 3, amount: 4, counterparty: 5, objectText: 6, costItemText: 7, comment: 8 });
    const p = buildAccountingPreview(sheets(), m);
    expect(p.rows).toHaveLength(6);
    expect(p.rows[0]).toMatchObject({ date: "2026-10-01", account: "1636", corrAccount: "3110", amount: "150000.00", counterparty: "ОсОО Тест-Монолит" });
    expect(p.rows[3].amount).toBe("-20000.00"); // знак сохраняется
    expect(p.rows[5].errors.length).toBeGreaterThan(0);
    expect(p.fileTotals[0].text).toMatch(/Обороты/);
    expect(p.sourceTotal).toBe("231000.00");
    expect(p.rows[4].warnings.join()).toMatch(/аналитики/); // тест 8: без объекта/статьи
  });

  it("одинаковые строки получают разные отпечатки; повторный разбор того же файла — те же отпечатки (тест 4)", () => {
    const m = guessAccountingMapping(sheets());
    const a = buildAccountingPreview(sheets(), m);
    const b = buildAccountingPreview(sheets(), m);
    expect(a.rows[1].contentKey).toBe(a.rows[2].contentKey);
    expect(a.rows[1].fingerprint).not.toBe(a.rows[2].fingerprint);
    expect(a.rows.map((r) => r.fingerprint)).toEqual(b.rows.map((r) => r.fingerprint));
  });

  it("режим дебет − кредит", () => {
    const csv = "Дата;Документ;Дебет;Кредит\n01.10.2026;Д1;100;\n02.10.2026;Д2;;30\n";
    const s = [parseCsv(Buffer.from(csv))];
    const m = guessAccountingMapping(s);
    expect(m.amountMode).toBe("debit_minus_credit");
    const p = buildAccountingPreview(s, m);
    expect(p.rows.map((r) => r.amount)).toEqual(["100.00", "-30.00"]);
  });

  it("правила: первое по приоритету, условия по «И»", () => {
    const rules: RuleInput[] = [
      { id: "r1", priority: 10, isActive: true, account: "1637", corrAccount: "1636", textContains: null, counterpartyContains: null, category: "INTERNAL_TRANSFER", workItemId: null, contractId: null },
      { id: "r2", priority: 20, isActive: true, account: "1636", corrAccount: null, textContains: "монолит", counterpartyContains: null, category: "COST", workItemId: "w1", contractId: null },
      { id: "r3", priority: 5, isActive: false, account: "1636", corrAccount: null, textContains: null, counterpartyContains: null, category: "OTHER", workItemId: null, contractId: null },
    ];
    const p = buildAccountingPreview(sheets(), guessAccountingMapping(sheets()));
    expect(matchRule(p.rows[0], rules)?.id).toBe("r2");
    expect(matchRule(p.rows[3], rules)?.id).toBe("r1");
    expect(matchRule(p.rows[1], rules)).toBeNull();
  });
});
