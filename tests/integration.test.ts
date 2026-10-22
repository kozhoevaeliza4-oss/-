/**
 * Интеграционные тесты сервисного слоя на реальной PostgreSQL (тестовая БД).
 */
import { beforeAll, describe, expect, inject, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/server/db";
import { createProject } from "@/lib/server/services/project";
import { approveVersion, confirmEstimateImport, loadEstimateJob, startEstimateImport } from "@/lib/server/services/estimate";
import { recordProgress, updateWorkItem } from "@/lib/server/services/workItem";
import { addMember } from "@/lib/server/services/users";
import { loadRegistry } from "@/lib/server/registry";
import { DEFAULT_ROLES } from "@/lib/permissions";

const enabled = inject("integrationDb");

async function xlsxFile(name: string, rows: (string | number | null)[][]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Смета");
  rows.forEach((r) => ws.addRow(r));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new File([buf], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const HEADER = ["№ п/п", "Шифр", "Наименование работ", "Ед. изм.", "Количество", "Цена за ед.", "Стоимость"];
const V1 = [
  HEADER,
  ["Раздел 1. Отделка"],
  [1, "15-01-001", "Штукатурка стен", "м2", 100, 1000, null],
  [2, "15-04-001", "Окраска стен", "м2", 100, 300, 30000],
  [3, "ПНР", "Пусконаладка", "компл", 1, 500000, 500000],
];
const V2 = [
  HEADER,
  ["Раздел 1. Отделка"],
  [1, "15-01-001", "Штукатурка стен", "м2", 120, 1000, null],
  [3, "ПНР", "Пусконаладка", "компл", 1, 500000, 500000],
  [4, "15-06-001", "Облицовка плиткой", "м2", 40, 2000, 80000],
];

describe.runIf(enabled)("Интеграция: смета, реестр, выполнение", () => {
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { email: `pto-${Date.now()}@test.local`, name: "Тест ПТО", passwordHash: "x" } });
    userId = u.id;
    for (const r of DEFAULT_ROLES)
      await prisma.role.upsert({ where: { code: r.code }, update: {}, create: { code: r.code, name: r.name, permissions: r.permissions } });
    const p = await createProject(userId, { code: `T-${Date.now()}`, name: "Тестовый проект", currency: "KGS" });
    projectId = p.id;
  });

  it("импорт создаёт только черновик; реестр меняется после утверждения; первая версия — первоначальная", async () => {
    const jobId = await startEstimateImport(userId, projectId, { file: await xlsxFile("v1.xlsx", V1), name: "v1", notes: null, allowDuplicate: false });
    const job = await loadEstimateJob(projectId, jobId);
    expect(job!.preview!.lines).toHaveLength(3);
    expect(job!.preview!.errorCount).toBe(0);

    const versionId = await confirmEstimateImport(userId, projectId, jobId);
    let reg = await loadRegistry(projectId);
    expect(reg.rows).toHaveLength(0);

    await approveVersion(userId, projectId, versionId, "основание");
    reg = await loadRegistry(projectId);
    expect(reg.rows).toHaveLength(3);
    expect(reg.coverage.totalEstimate!.toFixed(2)).toBe("630000.00");
    expect(reg.coverage.coveragePercent!.toFixed(2)).toBe("0.00");
    const v = await prisma.estimateVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(v.status).toBe("ACTIVE");
    expect(v.isBaseline).toBe(true);
    // журнал импорта
    const confirmed = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("повторная загрузка того же файла блокируется без явного подтверждения", async () => {
    await expect(
      startEstimateImport(userId, projectId, { file: await xlsxFile("v1-copy.xlsx", V1), name: "повтор", notes: null, allowDuplicate: false }),
    ).rejects.toThrow(/уже загружался/);
  });

  it("Тест 1 на данных БД: 100 м² × 1000, факт 40 м²", async () => {
    const item = await prisma.workItem.findFirstOrThrow({ where: { projectId, code: "15-01-001" } });
    await recordProgress(userId, projectId, item.id, { asOfDate: "2026-10-01", quantity: "40", comment: "замер" }, { canConfirmOverrun: false });
    const r = (await loadRegistry(projectId, { workItemId: item.id })).rows[0];
    expect(r.plannedCost).toBe("100000");
    expect(Number(r.percentDisplay)).toBe(40);
    expect(Number(r.earnedValue)).toBe(40000);
    expect(Number(r.remainingQuantity)).toBe(60);
    expect(Number(r.remainingCost)).toBe(60000);
  });

  it("Тест 7. История: 20% → 35%, оба значения с датой, автором и комментарием", async () => {
    const item = await prisma.workItem.findFirstOrThrow({ where: { projectId, code: "ПНР" } });
    await updateWorkItem(userId, projectId, item.id, { measurementType: "PERCENT" });
    await recordProgress(userId, projectId, item.id, { asOfDate: "2026-10-01", percent: "20", comment: "этап 1" }, { canConfirmOverrun: false });
    await recordProgress(userId, projectId, item.id, { asOfDate: "2026-10-15", percent: "35", comment: "этап 2" }, { canConfirmOverrun: false });
    // QA-12: недопустимые значения отклоняются понятным сообщением, а не ошибкой базы данных
    await expect(recordProgress(userId, projectId, item.id, { asOfDate: "2026-10-16", percent: "1000000", comment: "x" }, { canConfirmOverrun: true })).rejects.toThrow(/не может превышать 1000/);
    await expect(recordProgress(userId, projectId, item.id, { asOfDate: "2026-10-16", percent: "5e3", comment: "x" }, { canConfirmOverrun: true })).rejects.toThrow(/введите число/);

    const r = (await loadRegistry(projectId, { workItemId: item.id })).rows[0];
    expect(Number(r.percentDisplay)).toBe(35);
    expect(Number(r.earnedValue)).toBe(175000);

    const history = await prisma.workProgressRecord.findMany({ where: { workItemId: item.id }, orderBy: { createdAt: "asc" }, include: { user: true } });
    expect(history.map((h) => Number(h.percent))).toEqual([20, 35]);
    expect(Number(history[1].previousPercent)).toBe(20);
    expect(history.map((h) => h.comment)).toEqual(["этап 1", "этап 2"]);
    expect(history.every((h) => h.user.name === "Тест ПТО" && h.asOfDate instanceof Date)).toBe(true);
    const audit = await prisma.auditLog.count({ where: { entityId: item.id, action: "progress.record" } });
    expect(audit).toBe(2);
  });

  it("без комментария и даты выполнение не сохраняется", async () => {
    const item = await prisma.workItem.findFirstOrThrow({ where: { projectId, code: "15-01-001" } });
    await expect(recordProgress(userId, projectId, item.id, { asOfDate: "2026-10-02", quantity: "50", comment: " " }, { canConfirmOverrun: false })).rejects.toThrow(/комментарий/);
    await expect(recordProgress(userId, projectId, item.id, { asOfDate: undefined, quantity: "50", comment: "x" }, { canConfirmOverrun: false })).rejects.toThrow(/дату/);
  });

  it("Тест 6. Превышение: без права подтвердить нельзя; неподтверждённое не скрывается", async () => {
    const item = await prisma.workItem.findFirstOrThrow({ where: { projectId, code: "15-01-001" } });
    await expect(
      recordProgress(userId, projectId, item.id, { asOfDate: "2026-10-05", quantity: "110", comment: "x", overrunConfirmed: true }, { canConfirmOverrun: false }),
    ).rejects.toThrow(/права/);
    const res = await recordProgress(userId, projectId, item.id, { asOfDate: "2026-10-05", quantity: "110", comment: "факт" }, { canConfirmOverrun: false });
    expect(res.exceedsUnconfirmed).toBe(true);
    let r = (await loadRegistry(projectId, { workItemId: item.id })).rows[0];
    expect(Number(r.percentRaw)).toBe(110);
    expect(Number(r.percentDisplay)).toBe(100);
    expect(Number(r.overrunQuantity)).toBe(10);
    await recordProgress(userId, projectId, item.id, { asOfDate: "2026-10-06", quantity: "110", comment: "подтверждено письмом", overrunConfirmed: true }, { canConfirmOverrun: true });
    r = (await loadRegistry(projectId, { workItemId: item.id })).rows[0];
    expect(Number(r.percentDisplay)).toBe(110);
    expect(r.overrunConfirmed).toBe(true);
  });

  it("новая версия: история сохраняется, исключённая статья остаётся в реестре как недействующая", async () => {
    const jobId = await startEstimateImport(userId, projectId, { file: await xlsxFile("v2.xlsx", V2), name: "v2", notes: null, allowDuplicate: false });
    const versionId = await confirmEstimateImport(userId, projectId, jobId);
    await approveVersion(userId, projectId, versionId, null);

    const versions = await prisma.estimateVersion.findMany({ where: { projectId }, orderBy: { versionNumber: "asc" } });
    expect(versions.map((v) => [v.status, v.isBaseline])).toEqual([["SUPERSEDED", true], ["ACTIVE", false]]);

    const reg = await loadRegistry(projectId);
    expect(reg.rows).toHaveLength(4);
    const plaster = reg.rows.find((r) => r.code === "15-01-001")!;
    expect(plaster.plannedCost).toBe("120000");
    expect(plaster.baselinePlannedCost).toBe("100000");
    // факт по статье сохранился при смене версии (связь по ключу)
    expect(plaster.actualQuantity).toBe("110");
    const paint = reg.rows.find((r) => r.code === "15-04-001")!;
    expect(paint.active).toBe(false);
    expect(reg.coverage.totalEstimate!.toFixed(2)).toBe("700000.00");
  });

  it("нельзя назначить роль с правами выше собственных", async () => {
    const other = await prisma.user.create({ data: { email: `v-${Date.now()}@test.local`, name: "Наблюдатель", passwordHash: "x" } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "admin" } });
    await expect(addMember(userId, projectId, other.email, adminRole.id, new Set(["project.view", "project.members"]))).rejects.toThrow(/превышающими/);
    const viewer = await prisma.role.findUniqueOrThrow({ where: { code: "viewer" } });
    await addMember(userId, projectId, other.email, viewer.id, new Set(["project.view", "project.members"]));
    expect(await prisma.projectMember.count({ where: { projectId, userId: other.id } })).toBe(1);
  });
});
