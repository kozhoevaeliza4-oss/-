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
