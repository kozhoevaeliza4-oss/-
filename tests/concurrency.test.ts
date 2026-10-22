/**
 * Конкурентные операции (QA): два одновременных подтверждения одного импорта или утверждения
 * одной версии не должны создавать дубли или две действующие версии.
 */
import { beforeAll, describe, expect, inject, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/server/db";
import { createProject } from "@/lib/server/services/project";
import { approveVersion, confirmEstimateImport, startEstimateImport } from "@/lib/server/services/estimate";
import { confirmAccountingImport, startAccountingImport } from "@/lib/server/services/accounting";

const enabled = inject("integrationDb");

async function xlsx(rows: (string | number | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Смета");
  rows.forEach((r) => ws.addRow(r));
  return new File([Buffer.from(await wb.xlsx.writeBuffer())], "c.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
const ROWS = [["№", "Шифр", "Наименование работ", "Ед. изм.", "Количество", "Цена за ед.", "Стоимость"], [1, "A-1", "Кладка", "м3", 10, 100, 1000]];

describe.runIf(enabled)("Конкурентные операции", () => {
  let userId: string;
  let projectId: string;
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `cc-${Date.now()}@t.local`, name: "Параллельный", passwordHash: "x" } })).id;
    projectId = (await createProject(userId, { code: `CC-${Date.now()}`, name: "Конкурентность", currency: "KGS" })).id;
  });

  it("двойное подтверждение импорта сметы создаёт одну версию", async () => {
    const job = await startEstimateImport(userId, projectId, { file: await xlsx(ROWS), name: "v1", notes: null, allowDuplicate: false });
    const res = await Promise.allSettled([confirmEstimateImport(userId, projectId, job), confirmEstimateImport(userId, projectId, job)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.estimateVersion.count({ where: { projectId } })).toBe(1);
  });

  it("двойное утверждение версии: одна действующая версия, один журнал утверждения", async () => {
    const v = await prisma.estimateVersion.findFirstOrThrow({ where: { projectId } });
    const res = await Promise.allSettled([approveVersion(userId, projectId, v.id, "a"), approveVersion(userId, projectId, v.id, "b")]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.estimateVersion.count({ where: { projectId, status: "ACTIVE" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { projectId, action: "estimate.approve" } })).toBe(1);
  });

  it("двойное подтверждение импорта 1С не дублирует операции", async () => {
    const file = new File([Buffer.from("Дата;Документ;Счет Дт;Счет Кт;Сумма\n01.10.2026;Д-1;1636;3110;100\n02.10.2026;Д-2;1636;3110;200\n")], "1c.csv", { type: "text/csv" });
    const job = await startAccountingImport(userId, projectId, file);
    await Promise.allSettled([confirmAccountingImport(userId, projectId, job), confirmAccountingImport(userId, projectId, job)]);
    expect(await prisma.accountingTransaction.count({ where: { projectId } })).toBe(2);
  });
});
