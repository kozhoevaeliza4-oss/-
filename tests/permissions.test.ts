/**
 * Тест 8: пользователь без права редактирования не может изменить данные через серверные действия и API.
 * Используется настоящая проверка сессии (cookie → БД) — подменяется только хранилище cookie Next.js.
 */
import { beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const enabled = inject("integrationDb");

describe.runIf(enabled)("Тест 8: права доступа на сервере", () => {
  let projectId: string;
  let otherProjectId: string;
  let itemId: string;
  let prisma: typeof import("@/lib/server/db").prisma;

  async function loginAs(userId: string) {
    const token = randomBytes(16).toString("hex");
    await prisma.session.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } });
    jar.set("cr_session", token);
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/server/db"));
    const { DEFAULT_ROLES } = await import("@/lib/permissions");
    for (const r of DEFAULT_ROLES) await prisma.role.upsert({ where: { code: r.code }, update: {}, create: { code: r.code, name: r.name, permissions: r.permissions } });
    const p = await prisma.project.create({ data: { code: `PERM-${Date.now()}`, name: "Права" } });
    const p2 = await prisma.project.create({ data: { code: `PERM2-${Date.now()}`, name: "Чужой проект" } });
    projectId = p.id;
    otherProjectId = p2.id;
    itemId = (await prisma.workItem.create({ data: { projectId, itemKey: "x", name: "Статья", unit: "м2" } })).id;
  });

  it("наблюдатель: чтение есть, изменение выполнения и статьи — отказ", async () => {
    const viewer = await prisma.user.create({ data: { email: `viewer-${Date.now()}@t.local`, name: "Наблюдатель", passwordHash: "x" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "viewer" } });
    await prisma.projectMember.create({ data: { projectId, userId: viewer.id, roleId: role.id } });
    await loginAs(viewer.id);
    const { recordProgressAction, updateItemAction } = await import("@/app/(app)/projects/[projectId]/items/actions");
    const fd = new FormData();
    fd.set("quantity", "10");
    fd.set("asOfDate", "2026-10-01");
    fd.set("comment", "попытка");
    const r1 = await recordProgressAction(projectId, itemId, null, fd);
    expect(r1).toMatchObject({ ok: false, error: "Недостаточно прав" });
    const fd2 = new FormData();
    fd2.set("measurementType", "PERCENT");
    const r2 = await updateItemAction(projectId, itemId, null, fd2);
    expect(r2?.ok).toBe(false);
    expect(await prisma.workProgressRecord.count({ where: { workItemId: itemId } })).toBe(0);
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: itemId } })).measurementType).toBe("QUANTITY");

    // экспорт без права report.export — 403; чужой проект — 404
    const { GET } = await import("@/app/api/projects/[projectId]/registry/export/route");
    const res = await GET(new Request("http://x/api"), { params: Promise.resolve({ projectId }) });
    expect(res.status).toBe(403);
    const res2 = await GET(new Request("http://x/api"), { params: Promise.resolve({ projectId: otherProjectId }) });
    expect(res2.status).toBe(404);
  });

  it("ПТО: может обновить выполнение, но не может подписать АВР и классифицировать 1С", async () => {
    const pto = await prisma.user.create({ data: { email: `pto-${Date.now()}@t.local`, name: "ПТО", passwordHash: "x" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "pto" } });
    await prisma.projectMember.create({ data: { projectId, userId: pto.id, roleId: role.id } });
    await loginAs(pto.id);
    const { recordProgressAction } = await import("@/app/(app)/projects/[projectId]/items/actions");
    const fd = new FormData();
    fd.set("quantity", "10");
    fd.set("asOfDate", "2026-10-01");
    fd.set("comment", "замер");
    expect((await recordProgressAction(projectId, itemId, null, fd))?.ok).toBe(true);

    const act = await prisma.act.create({ data: { projectId, number: "1", date: new Date("2026-10-01"), currency: "KGS", status: "ON_APPROVAL", lines: { create: { description: "x", amount: 10 } } } });
    const { changeActStatusAction } = await import("@/app/(app)/projects/[projectId]/acts/actions");
    const fs = new FormData();
    fs.set("status", "SIGNED");
    fs.set("signedAt", "2026-10-02");
    expect(await changeActStatusAction(projectId, act.id, null, fs)).toMatchObject({ ok: false, error: "Недостаточно прав" });
    expect((await prisma.act.findUniqueOrThrow({ where: { id: act.id } })).status).toBe("ON_APPROVAL");

    const { classifyAction } = await import("@/app/(app)/projects/[projectId]/accounting/actions");
    const fc = new FormData();
    fc.append("ids", "x");
    expect((await classifyAction(projectId, null, fc))?.ok).toBe(false);
  });

  it("QA-02: роль без прав на 1С/договоры/АВР не получает эти данные в реестре, экспорте и отчётах", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const role = await prisma.role.create({ data: { code: `exp-${Date.now()}`, name: "Только реестр и экспорт", permissions: ["project.view", "report.export"] } });
    const u = await prisma.user.create({ data: { email: `exp-${Date.now()}@t.local`, name: "Экспорт", passwordHash: "x" } });
    await prisma.projectMember.create({ data: { projectId, userId: u.id, roleId: role.id } });
    await loginAs(u.id);

    const { GET } = await import("@/app/api/projects/[projectId]/registry/export/route");
    const res = await GET(new Request("http://x/api?contract=covered"), { params: Promise.resolve({ projectId }) });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.worksheets[0];
    const header = (ws.getRow(6).values as unknown[]).map(String);
    expect(header).toContain("Наименование работы");
    for (const hidden of ["Затраты по данным 1С", "Оплачено", "Отклонение от плана", "Подрядчик", "Стоимость по подписанным АВР", "Статус договорного покрытия"]) expect(header).not.toContain(hidden);
    // фильтр по наличию договора проигнорирован — статья без договора не отфильтрована
    expect(String(ws.getCell("A3").value)).toMatch(/Фильтры: нет/);

    const rep = await import("@/app/api/projects/[projectId]/reports/[kind]/route");
    for (const kind of ["plan-fact", "coverage", "acts", "contractors", "unclassified-1c", "forecast", "structure", "reconciliation", "audit", "critical"]) {
      const r = await rep.GET(new Request("http://x/api"), { params: Promise.resolve({ projectId, kind }) });
      expect(r.status, kind).toBe(403);
    }
    const ok = await rep.GET(new Request("http://x/api"), { params: Promise.resolve({ projectId, kind: "progress" }) });
    expect(ok.status).toBe(200);

    const { redactRow } = await import("@/lib/server/visibility");
    const { loadRegistry } = await import("@/lib/server/registry");
    const row = (await loadRegistry(projectId)).rows[0];
    const red = redactRow({ ...row, accountingCost: "100", actsAccepted: "50", contractors: ["ОсОО Тест"], flags: [{ level: "red", code: "COST_OVERRUN", text: "x" }] }, { accounting: false, contracts: false, acts: false });
    expect(red).toMatchObject({ accountingCost: null, actsAccepted: null, contractors: [], coverageLabel: "нет доступа" });
    expect(red.flags.map((f) => f.code)).not.toContain("COST_OVERRUN");
    expect(red.level).not.toBe("red");
    expect(red.hidden).toEqual(["accounting", "contracts", "acts"]);
  });

  it("отозванный пользователь не может выполнить действие даже с действующей cookie", async () => {
    const u = await prisma.user.create({ data: { email: `rev-${Date.now()}@t.local`, name: "Уволен", passwordHash: "x", isAdmin: true } });
    await loginAs(u.id);
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    const { recordProgressAction } = await import("@/app/(app)/projects/[projectId]/items/actions");
    const fd = new FormData();
    fd.set("quantity", "1");
    fd.set("asOfDate", "2026-10-01");
    fd.set("comment", "x");
    const r = await recordProgressAction(projectId, itemId, null, fd);
    expect(r?.ok).toBe(false);
  });
});
