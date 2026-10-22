/**
 * Аналитика: валюты (тест 11), воспроизводимость истории (тест 12), расшифровки (тест 15),
 * проблемы и отклонения, все отчёты и экспорт XLSX/PDF.
 */
import { beforeAll, describe, expect, inject, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/server/db";
import { createProject } from "@/lib/server/services/project";
import { createContract, setAllocationStatus, setContractStatus, upsertAllocation } from "@/lib/server/services/contract";
import { changeActStatus, createAct } from "@/lib/server/services/act";
import { recordProgress } from "@/lib/server/services/workItem";
import { loadRegistry } from "@/lib/server/registry";
import { loadDashboard } from "@/lib/server/dashboard";
import { EXPLAIN_METRICS, ExplainMetric, explainMetric } from "@/lib/server/explain";
import { syncIssues, updateIssue } from "@/lib/server/services/issues";
import { buildReport, REPORTS } from "@/lib/server/reports";
import { reportToPdf, reportToXlsx } from "@/lib/server/reportExport";

const enabled = inject("integrationDb");

describe.runIf(enabled)("Аналитика", () => {
  let userId: string;
  let projectId: string;
  let a: string; // статья с договором
  let b: string; // статья без договора
  let contractId: string;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `an-${Date.now()}@t.local`, name: "Аналитик", passwordHash: "x" } })).id;
    projectId = (await createProject(userId, { code: `AN-${Date.now()}`, name: "Аналитика", currency: "KGS" })).id;
    const v1 = await prisma.estimateVersion.create({ data: { projectId, versionNumber: 1, name: "v1", status: "SUPERSEDED", isBaseline: true, currency: "KGS", approvedAt: new Date("2026-01-10T10:00:00Z") } });
    const v2 = await prisma.estimateVersion.create({ data: { projectId, versionNumber: 2, name: "v2", status: "ACTIVE", currency: "KGS", approvedAt: new Date("2026-06-01T10:00:00Z") } });
    a = (await prisma.workItem.create({ data: { projectId, itemKey: "a", code: "A", name: "Кладка", unit: "м3", plannedEndDate: new Date("2026-03-01") } })).id;
    b = (await prisma.workItem.create({ data: { projectId, itemKey: "b", code: "B", name: "Кровля", unit: "м2" } })).id;
    await prisma.estimateLine.createMany({
      data: [
        { versionId: v1.id, workItemId: a, itemKey: "a", name: "Кладка", quantity: 100, unitPrice: 1000, currency: "KGS" },
        { versionId: v1.id, workItemId: b, itemKey: "b", name: "Кровля", quantity: 50, unitPrice: 2000, currency: "KGS" },
        { versionId: v2.id, workItemId: a, itemKey: "a", name: "Кладка", quantity: 120, unitPrice: 1000, currency: "KGS" },
        // строка в другой валюте — не суммируется с сомами
        { versionId: v2.id, workItemId: b, itemKey: "b", name: "Кровля", quantity: 50, unitPrice: 30, currency: "USD" },
      ],
    });
    contractId = await createContract(userId, projectId, { newContractorName: "ОсОО Аналитик-Строй", number: "К-1", date: "2026-02-01", totalAmount: "150000", currency: "KGS" });
    await setContractStatus(userId, projectId, contractId, "ACTIVE", null);
    await upsertAllocation(userId, projectId, contractId, { workItemId: a, quantity: "120", unitPrice: "1000", amount: "" });
    const al = await prisma.contractWorkAllocation.findFirstOrThrow({ where: { contractId } });
    await setAllocationStatus(userId, projectId, al.id, "CONFIRMED");
    // договор в долларах — не складывается с сомами
    const usd = await createContract(userId, projectId, { newContractorName: "Foreign LLC", number: "USD-1", date: "2026-02-01", totalAmount: "999", currency: "USD" });
    await setContractStatus(userId, projectId, usd, "ACTIVE", null);
    await recordProgress(userId, projectId, a, { asOfDate: "2026-05-01", quantity: "30", comment: "май" }, { canConfirmOverrun: false });
    await recordProgress(userId, projectId, a, { asOfDate: "2026-07-01", quantity: "60", comment: "июль" }, { canConfirmOverrun: false });
    const act = await createAct(userId, projectId, { number: "1", date: "2026-07-05", contractId, currency: "KGS" }, [{ description: "Кладка", quantity: "50", unitPrice: "1000", amount: "50000", allocations: [{ workItemId: a, quantity: "50", amount: "50000" }] }]);
    await changeActStatus(userId, projectId, act, "SIGNED", { comment: null, signedAt: "2026-07-06", canOverride: false });
    const usdAct = await createAct(userId, projectId, { number: "U1", date: "2026-07-05", contractId: usd, currency: "USD" }, [{ description: "x", amount: "500" }]);
    await changeActStatus(userId, projectId, usdAct, "SIGNED", { comment: null, signedAt: "2026-07-06", canOverride: false });
  });

  it("Тест 11: суммы в разных валютах не складываются", async () => {
    const reg = await loadRegistry(projectId);
    const rb = reg.rows.find((r) => r.id === b)!;
    expect(rb.plannedCost).toBeNull();
    expect(rb.flags.map((f) => f.code)).toContain("PLAN_CURRENCY");
    expect(reg.coverage.totalEstimate!.toFixed(2)).toBe("120000.00");
    const d = await loadDashboard(projectId);
    expect(d.cards.contractsTotal).toBe("150000");
    expect(d.cards.actsSigned).toBe("50000");
  });

  it("Тест 12: состояние на дату воспроизводится после смены версии сметы", async () => {
    const before = await loadRegistry(projectId, { workItemId: a, asOf: "2026-05-15" });
    expect(before.currentVersion?.versionNumber).toBe(1);
    expect(before.rows[0].plannedCost).toBe("100000");
    expect(before.rows[0].actualQuantity).toBe("30");
    expect(before.rows[0].percentDisplay).toBe("30");
    expect(before.rows[0].actsAccepted).toBeNull();
    const now = await loadRegistry(projectId, { workItemId: a });
    expect(now.rows[0].plannedCost).toBe("120000");
    expect(now.rows[0].percentDisplay).toBe("50");
    expect(now.rows[0].actsAccepted).toBe("50000");
    const rep = await buildReport(projectId, "progress", { asOf: "2026-05-15" });
    expect(rep!.rows.find((r) => r.code === "A")!.percent).toBe("30");
  });

  it("Тест 15: итоговые суммы раскрываются до первичных записей", async () => {
    for (const m of Object.keys(EXPLAIN_METRICS) as ExplainMetric[]) {
      const e = await explainMetric(projectId, m);
      expect(e.matches, `${m}: ${e.total} vs ${e.recordsTotal}`).toBe(true);
    }
    const d = await loadDashboard(projectId);
    expect((await explainMetric(projectId, "earned")).total).toBe(Number(d.cards.earned.sum).toFixed(2));
    expect((await explainMetric(projectId, "contractsTotal")).total).toBe(Number(d.cards.contractsTotal).toFixed(2));
    const acts = await explainMetric(projectId, "actsSigned");
    expect(acts.records).toHaveLength(1); // акт в USD не входит
  });

  it("Проблемы: создаются проверкой, устраняются только данными или исключением", async () => {
    await syncIssues(projectId, userId);
    const issues = await prisma.issue.findMany({ where: { projectId } });
    const types = issues.map((i) => i.type);
    expect(types).toContain("OVERDUE"); // A: срок 01.03.2026, 50 %
    expect(types).toContain("ACTS_RECONCILIATION"); // выполнено 60 000, АВР 50 000
    const overdue = issues.find((i) => i.type === "OVERDUE")!;
    await expect(updateIssue(userId, projectId, overdue.id, { status: "RESOLVED" })).rejects.toThrow(/автоматически/);
    await expect(updateIssue(userId, projectId, overdue.id, { status: "CLOSED_EXCEPTION", comment: "ок" })).rejects.toThrow(/обоснование/);
    // устранение данными: перенос срока
    await prisma.workItem.update({ where: { id: a }, data: { plannedEndDate: new Date("2027-01-01") } });
    const r = await syncIssues(projectId, userId);
    expect(r.resolved).toBeGreaterThanOrEqual(1);
    const after = await prisma.issue.findUniqueOrThrow({ where: { id: overdue.id }, include: { events: true } });
    expect(after.status).toBe("RESOLVED");
    expect(after.events.map((e) => e.action)).toContain("resolved");
    // исключение с обоснованием сохраняется при последующих проверках
    const rec = issues.find((i) => i.type === "ACTS_RECONCILIATION")!;
    await updateIssue(userId, projectId, rec.id, { status: "CLOSED_EXCEPTION", comment: "АВР за июль подписывается в августе — согласовано с ПТО" });
    await syncIssues(projectId, userId);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe("CLOSED_EXCEPTION");
  });

  it("Все 14 отчётов формируются; экспорт XLSX и PDF содержит метаданные", async () => {
    expect(Object.keys(REPORTS)).toHaveLength(14);
    for (const k of Object.keys(REPORTS)) {
      const r = await buildReport(projectId, k, {});
      expect(r, k).not.toBeNull();
      expect(r!.columns.length || k === "estimate-compare").toBeTruthy();
    }
    const cov = (await buildReport(projectId, "coverage", {}))!;
    const meta = { projectName: "Аналитика", projectCode: "AN", isDemo: false, generatedAt: new Date(), userName: "Аналитик", filters: "object=1" };
    const pdf = await reportToPdf(cov, meta);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const xlsx = await reportToXlsx(cov, meta);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(String(ws.getCell("A1").value)).toBe("Договорное покрытие сметы");
    expect(String(ws.getCell("A4").value)).toMatch(/Фильтры: object=1/);
    expect(String(ws.getCell("A5").value)).toMatch(/Методика/);
  });
});
