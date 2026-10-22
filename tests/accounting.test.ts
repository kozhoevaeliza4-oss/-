import { beforeAll, describe, expect, inject, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { createProject, updateFinanceSettings } from "@/lib/server/services/project";
import { createContract } from "@/lib/server/services/contract";
import { classifyTransactions, confirmAccountingImport, createRule, loadAccountingJob, splitTransaction, startAccountingImport } from "@/lib/server/services/accounting";
import { loadRegistry } from "@/lib/server/registry";

const enabled = inject("integrationDb");

const csv = (rows: string[]) => new File([Buffer.from(["Дата;Документ;Счет Дт;Счет Кт;Сумма;Контрагент;Объект строительства;Статья затрат;Содержание", ...rows].join("\n"))], "1c.csv", { type: "text/csv" });
const ROWS = [
  "01.10.2026;ПУ-12;1636;3110;150000;ОсОО Тест;Корпус 1;Монолит;Колонны",
  "05.10.2026;ПМ-31;1636;3110;48000;ОсОО Бетон;Корпус 1;Материалы;Бетон",
  "05.10.2026;ПМ-31;1636;3110;48000;ОсОО Бетон;Корпус 1;Материалы;Бетон",
  "12.10.2026;Оп-77;1636;3110;5000;;;;",
  "15.10.2026;ПП-5;3110;5110;-200000;ОсОО Тест;;;Оплата по договору",
];

describe.runIf(enabled)("Импорт 1С", () => {
  let userId: string;
  let projectId: string;
  let itemId: string;
  let contractId: string;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `acc-${Date.now()}@test.local`, name: "Бухгалтер", passwordHash: "x" } })).id;
    projectId = (await createProject(userId, { code: `ACC-${Date.now()}`, name: "1С тест", currency: "KGS" })).id;
    const v = await prisma.estimateVersion.create({ data: { projectId, versionNumber: 1, name: "v1", status: "ACTIVE", isBaseline: true, currency: "KGS", approvedAt: new Date() } });
    itemId = (await prisma.workItem.create({ data: { projectId, itemKey: "k1", code: "06-01", name: "Монолит", unit: "м3" } })).id;
    await prisma.estimateLine.create({ data: { versionId: v.id, workItemId: itemId, itemKey: "k1", name: "Монолит", quantity: 100, unitPrice: 2000, currency: "KGS" } });
    contractId = await createContract(userId, projectId, { newContractorName: "ОсОО Тест", number: "Д-1", date: "2026-01-01", totalAmount: "1000000" });
    await createRule(userId, projectId, { name: "Монолит", account: "1636", textContains: "монолит", category: "COST", workItemId: itemId });
  });

  it("Тест 4: повторный импорт того же файла не создаёт дублей", async () => {
    const j1 = await startAccountingImport(userId, projectId, csv(ROWS));
    const s1 = await confirmAccountingImport(userId, projectId, j1);
    expect(s1.inserted).toBe(5);
    const j2 = await startAccountingImport(userId, projectId, csv(ROWS));
    const pre = await loadAccountingJob(projectId, j2);
    expect(pre!.result!.newRows).toBe(0);
    expect(pre!.result!.sameFileImports.length).toBe(1);
    const s2 = await confirmAccountingImport(userId, projectId, j2);
    expect(s2.inserted).toBe(0);
    expect(s2.duplicates).toBe(5);
    expect(await prisma.accountingTransaction.count({ where: { projectId } })).toBe(5);
    // пересекающаяся выгрузка: добавится только новая строка
    const j3 = await startAccountingImport(userId, projectId, csv([...ROWS, "20.10.2026;ПУ-13;1636;3110;70000;ОсОО Тест;Корпус 1;Монолит;Перекрытия"]));
    expect((await confirmAccountingImport(userId, projectId, j3)).inserted).toBe(1);
  });

  it("Тест 5/8: без подтверждённой классификации затраты не входят в себестоимость статьи", async () => {
    const proposed = await prisma.accountingTransaction.findMany({ where: { projectId, classification: "PROPOSED" } });
    expect(proposed.length).toBe(2); // правило «Монолит» — только предложение
    let row = (await loadRegistry(projectId, { workItemId: itemId })).rows[0];
    expect(row.accountingCost).toBeNull();
    const unclassified = await prisma.accountingTransaction.findFirstOrThrow({ where: { projectId, documentNumber: "Оп-77" } });
    expect(unclassified.classification).toBe("UNCLASSIFIED");

    await classifyTransactions(userId, projectId, { ids: proposed.map((p) => p.id), category: "COST", workItemId: itemId });
    row = (await loadRegistry(projectId, { workItemId: itemId })).rows[0];
    expect(row.accountingCost).toBe("220000");
    expect(row.accountingCostLabel).toBe("Импортированные затраты по 1С");
    await updateFinanceSettings(userId, projectId, { costMethodologyConfirmed: true, costMethodologyNote: "Согласовано с гл. бухгалтером", forecastModelConfirmed: false });
    expect((await loadRegistry(projectId, { workItemId: itemId })).rows[0].accountingCostLabel).toBe("Фактические затраты");
  });

  it("разделение операции между статьями и платёж по договору", async () => {
    const item2 = (await prisma.workItem.create({ data: { projectId, itemKey: "k2", name: "Материалы", unit: "т" } })).id;
    const beton = await prisma.accountingTransaction.findMany({ where: { projectId, documentNumber: "ПМ-31" } });
    await expect(splitTransaction(userId, projectId, beton[0].id, [{ workItemId: itemId, amount: "40000" }, { workItemId: item2, amount: "7000" }])).rejects.toThrow(/не равна/);
    await splitTransaction(userId, projectId, beton[0].id, [{ workItemId: itemId, amount: "40000" }, { workItemId: item2, amount: "8000" }]);
    expect((await loadRegistry(projectId, { workItemId: item2 })).rows[0].accountingCost).toBe("8000");

    const pay = await prisma.accountingTransaction.findFirstOrThrow({ where: { projectId, documentNumber: "ПП-5" } });
    await expect(classifyTransactions(userId, projectId, { ids: [pay.id], category: "PAYMENT" })).rejects.toThrow(/договор/);
    await classifyTransactions(userId, projectId, { ids: [pay.id], category: "PAYMENT", contractId });
    const p = await prisma.payment.findFirstOrThrow({ where: { transactionId: pay.id } });
    expect(p.amount.toString()).toBe("200000");
    // повторная классификация не создаёт второй платёж
    await classifyTransactions(userId, projectId, { ids: [pay.id], category: "PAYMENT", contractId });
    expect(await prisma.payment.count({ where: { transactionId: pay.id } })).toBe(1);
  });

  it("Тест 13: сбой при импорте не повреждает подтверждённые данные", async () => {
    const before = await prisma.accountingTransaction.count({ where: { projectId } });
    const beforeCost = (await loadRegistry(projectId, { workItemId: itemId })).rows[0].accountingCost;
    // сумма превышает точность Decimal(18,2) — ошибка БД внутри транзакции
    const j = await startAccountingImport(userId, projectId, csv(["21.10.2026;X-1;1636;3110;150;;;;новая", "22.10.2026;X-2;1636;3110;1000000000000000000000;;;;переполнение"]));
    await expect(confirmAccountingImport(userId, projectId, j)).rejects.toThrow();
    expect(await prisma.accountingTransaction.count({ where: { projectId } })).toBe(before);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: j } })).status).toBe("PARSED");
    expect((await loadRegistry(projectId, { workItemId: itemId })).rows[0].accountingCost).toBe(beforeCost);
  });
});
