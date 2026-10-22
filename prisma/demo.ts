/**
 * ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ. Все значения вымышлены и предназначены только для проверки интерфейса и расчётов.
 * Проект создаётся с флагом isDemo = true и помечается в интерфейсе.
 *
 * Также создаёт пример файла сметы samples/demo-estimate-v2.xlsx для проверки импорта новой версии.
 *
 *   npm run db:demo            — создать/пересоздать демо-проект
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();
const CODE = "DEMO-ЖК";
const D = (s: string) => new Date(s + "T00:00:00Z");

type Line = { section: string; secName: string; code: string; name: string; unit: string; qty: number; price: number; total?: number; obj: string; stage: string; end: string };

const LINES: Line[] = [
  { section: "1", secName: "Земляные работы", code: "01-01-003", name: "Разработка грунта экскаватором", unit: "м3", qty: 4200, price: 350, obj: "К1", stage: "Э1", end: "2026-04-30" },
  { section: "1", secName: "Земляные работы", code: "01-02-001", name: "Обратная засыпка пазух котлована", unit: "м3", qty: 1100, price: 180, obj: "К1", stage: "Э1", end: "2026-09-30" },
  { section: "2", secName: "Фундаменты", code: "06-01-001", name: "Бетонирование фундаментной плиты", unit: "м3", qty: 820, price: 9500, total: 7800000, obj: "К1", stage: "Э1", end: "2026-07-15" },
  { section: "2", secName: "Фундаменты", code: "08-01-003", name: "Гидроизоляция фундаментов", unit: "м2", qty: 1900, price: 650, obj: "К1", stage: "Э1", end: "2026-08-01" },
  { section: "3", secName: "Каркас", code: "06-01-015", name: "Монолитные колонны и стены", unit: "м3", qty: 1450, price: 12500, obj: "К1", stage: "Э2", end: "2026-12-20" },
  { section: "3", secName: "Каркас", code: "06-01-034", name: "Монолитные перекрытия", unit: "м3", qty: 2100, price: 11800, obj: "К1", stage: "Э2", end: "2027-02-28" },
  { section: "4", secName: "Стены и перегородки", code: "08-02-001", name: "Кладка наружных стен из газоблока", unit: "м3", qty: 980, price: 7200, obj: "К1", stage: "Э2", end: "2027-04-30" },
  { section: "5", secName: "Кровля", code: "12-01-002", name: "Устройство кровли", unit: "м2", qty: 1250, price: 2400, obj: "К1", stage: "Э3", end: "2027-06-30" },
  { section: "6", secName: "Инженерные системы", code: "ПНР-01", name: "Пусконаладочные работы (комплекс)", unit: "компл", qty: 1, price: 3500000, obj: "К1", stage: "Э3", end: "2027-09-30" },
  { section: "1", secName: "Земляные работы", code: "01-01-003", name: "Разработка грунта экскаватором", unit: "м3", qty: 3800, price: 350, obj: "К2", stage: "Э1", end: "2026-06-30" },
  { section: "2", secName: "Фундаменты", code: "06-01-001", name: "Бетонирование фундаментной плиты", unit: "м3", qty: 760, price: 9500, obj: "К2", stage: "Э1", end: "2026-10-15" },
  { section: "3", secName: "Каркас", code: "06-01-015", name: "Монолитные колонны и стены", unit: "м3", qty: 1300, price: 12500, obj: "К2", stage: "Э2", end: "2027-03-31" },
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const keyOf = (l: Line) => [l.obj, l.section, l.code, l.name].map(norm).join("|");

async function main() {
  const old = await prisma.project.findUnique({ where: { code: CODE } });
  if (old) {
    if (!old.isDemo) throw new Error(`Проект ${CODE} существует и не помечен как демо — не трогаю`);
    await prisma.project.delete({ where: { id: old.id } });
    console.log("Старый демо-проект удалён");
  }

  // Демо-пользователи по ролям (пароль генерируется и печатается один раз)
  const password = process.env.DEMO_PASSWORD || randomBytes(9).toString("base64url");
  const hash = await bcrypt.hash(password, 12);
  const roles = await prisma.role.findMany();
  if (roles.length === 0) throw new Error("Сначала выполните npm run db:seed");
  const users: Record<string, string> = {};
  for (const r of roles.filter((x) => x.code !== "admin")) {
    const email = `demo.${r.code}@example.local`;
    const u = await prisma.user.upsert({ where: { email }, update: { passwordHash: hash, isActive: true }, create: { email, name: `Демо: ${r.name}`, passwordHash: hash } });
    users[r.code] = u.id;
  }
  const admin = await prisma.user.findFirst({ where: { isAdmin: true } });
  const actor = admin?.id ?? Object.values(users)[0];

  const project = await prisma.project.create({
    data: {
      code: CODE,
      name: "Жилой комплекс «Пример» (ДЕМО-ДАННЫЕ)",
      description: "Демонстрационный проект. Все суммы, договоры и подрядчики вымышлены.",
      currency: "KGS",
      isDemo: true,
      members: { create: roles.filter((r) => r.code !== "admin").map((r) => ({ userId: users[r.code], roleId: r.id })) },
    },
  });
  const pid = project.id;

  const objects = Object.fromEntries(
    await Promise.all(
      [["К1", "Корпус 1"], ["К2", "Корпус 2"]].map(async ([code, name], i) => [code, (await prisma.constructionObject.create({ data: { projectId: pid, code, name, sortOrder: i } })).id]),
    ),
  );
  const stages = Object.fromEntries(
    await Promise.all(
      [["Э1", "Нулевой цикл", "2026-03-01", "2026-10-31"], ["Э2", "Надземная часть", "2026-08-01", "2027-04-30"], ["Э3", "Кровля и инженерия", "2027-04-01", "2027-09-30"]].map(
        async ([code, name, s, e], i) => [code, (await prisma.constructionStage.create({ data: { projectId: pid, code, name, sortOrder: i, plannedStart: D(s), plannedEnd: D(e) } })).id],
      ),
    ),
  );
  const sections: Record<string, string> = {};
  for (const l of LINES) {
    if (sections[l.section]) continue;
    sections[l.section] = (await prisma.estimateSection.create({ data: { projectId: pid, code: l.section, name: l.secName, sortOrder: Number(l.section) } })).id;
  }

  // Версия 1 — утверждённая первоначальная смета
  const v1 = await prisma.estimateVersion.create({
    data: { projectId: pid, versionNumber: 1, name: "Сводная смета (ДЕМО), ред. 1", status: "ACTIVE", isBaseline: true, currency: "KGS", createdById: actor, approvedById: actor, approvedAt: D("2026-02-15") },
  });
  const items: Record<string, string> = {};
  for (const [i, l] of LINES.entries()) {
    const wi = await prisma.workItem.create({
      data: {
        projectId: pid,
        itemKey: keyOf(l),
        code: l.code,
        name: l.name,
        unit: l.unit,
        objectId: objects[l.obj],
        stageId: stages[l.stage],
        sectionId: sections[l.section],
        measurementType: l.unit === "компл" ? "PERCENT" : "QUANTITY",
        plannedEndDate: D(l.end),
        createdById: actor,
      },
    });
    items[`${l.obj}:${l.code}`] = wi.id;
    await prisma.estimateLine.create({
      data: {
        versionId: v1.id,
        workItemId: wi.id,
        itemKey: keyOf(l),
        lineNo: String(i + 1),
        code: l.code,
        name: l.name,
        unit: l.unit,
        sectionId: sections[l.section],
        sectionCode: l.section,
        sectionName: l.secName,
        objectCode: l.obj,
        stageCode: l.stage,
        quantity: l.qty,
        unitPrice: l.price,
        sourceTotal: l.total ?? l.qty * l.price,
        currency: "KGS",
        sourceSheet: "ДЕМО",
        sourceRow: i + 5,
      },
    });
  }

  // Выполнение (история)
  const pto = users["pto"];
  const progress: [string, string, number | null, number | null, string, boolean][] = [
    ["К1:01-01-003", "2026-03-31", 2500, null, "Исполнительная съёмка (ДЕМО)", false],
    ["К1:01-01-003", "2026-04-30", 4200, null, "Работы завершены (ДЕМО)", false],
    ["К1:01-02-001", "2026-10-01", 400, null, "Промежуточный замер (ДЕМО)", false],
    ["К1:06-01-001", "2026-07-20", 840, null, "Фактический объём больше проектного (ДЕМО)", false],
    ["К1:08-01-003", "2026-08-10", 1900, null, "Акт скрытых работ (ДЕМО)", false],
    ["К1:06-01-015", "2026-10-15", 650, null, "Замер на 15.10 (ДЕМО)", false],
    ["К1:06-01-034", "2026-10-15", 300, null, "Замер на 15.10 (ДЕМО)", false],
    ["К2:01-01-003", "2026-06-30", 3800, null, "Работы завершены (ДЕМО)", false],
    ["К2:06-01-001", "2026-10-10", 300, null, "Замер (ДЕМО)", false],
  ];
  for (const [k, date, qty, pct, comment, conf] of progress) {
    const prev = await prisma.workProgressRecord.findFirst({ where: { workItemId: items[k] }, orderBy: [{ asOfDate: "desc" }] });
    await prisma.workProgressRecord.create({
      data: { workItemId: items[k], asOfDate: D(date), method: qty !== null ? "QUANTITY" : "PERCENT", quantity: qty, percent: pct, previousQuantity: prev?.quantity ?? null, overrunConfirmed: conf, comment, userId: pto },
    });
  }

  // Договоры (ДЕМО): подрядчики вымышлены
  const c1 = await prisma.contractor.create({ data: { name: "ОсОО «Демо-Земстрой» (ДЕМО)" } });
  const c2 = await prisma.contractor.create({ data: { name: "ОсОО «Демо-Монолит» (ДЕМО)" } });
  const k1 = await prisma.contract.create({
    data: { projectId: pid, contractorId: c1.id, number: "Д-01/26", date: D("2026-02-20"), subject: "Земляные работы К1, К2", totalAmount: 2900000, currency: "KGS", startDate: D("2026-03-01"), endDate: D("2026-10-31"), status: "ACTIVE", verifiedById: actor, verifiedAt: D("2026-02-21") },
  });
  const k2 = await prisma.contract.create({
    data: { projectId: pid, contractorId: c2.id, number: "Д-02/26", date: D("2026-03-10"), subject: "Монолитные работы К1", totalAmount: 52000000, currency: "KGS", startDate: D("2026-04-01"), endDate: D("2027-03-31"), status: "ACTIVE", verifiedById: actor, verifiedAt: D("2026-03-11") },
  });
  await prisma.contract.create({
    data: { projectId: pid, contractorId: c2.id, number: "Д-05/26", date: D("2026-09-01"), subject: "Монолитные работы К2 (на проверке)", totalAmount: 24000000, currency: "KGS", status: "UPLOADED_NEEDS_REVIEW" },
  });
  const alloc = (contractId: string, k: string, qty: number, amount: number, status: "CONFIRMED" | "PROPOSED" = "CONFIRMED") =>
    prisma.contractWorkAllocation.create({ data: { contractId, workItemId: items[k], quantity: qty, amount, status, source: "ДЕМО" } });
  await alloc(k1.id, "К1:01-01-003", 4200, 1470000);
  await alloc(k1.id, "К2:01-01-003", 3800, 1330000);
  await alloc(k2.id, "К1:06-01-001", 820, 7900000);
  await alloc(k2.id, "К1:06-01-015", 1450, 18000000);
  await alloc(k2.id, "К1:06-01-034", 2100, 24600000);

  // АВР (ДЕМО)
  const act = await prisma.act.create({ data: { projectId: pid, contractId: k1.id, contractorId: c1.id, number: "АВР-1", date: D("2026-05-05"), status: "SIGNED", currency: "KGS", signedAt: D("2026-05-07") } });
  await actLine(act.id, items["К1:01-01-003"], "Разработка грунта экскаватором", 4200, 350, 1470000);
  const act2 = await prisma.act.create({ data: { projectId: pid, contractId: k2.id, contractorId: c2.id, number: "АВР-7", date: D("2026-08-05"), status: "SIGNED", currency: "KGS", signedAt: D("2026-08-07") } });
  await actLine(act2.id, items["К1:06-01-001"], "Бетонирование фундаментной плиты", 600, 9500, 5700000);
  const act3 = await prisma.act.create({ data: { projectId: pid, contractId: k2.id, contractorId: c2.id, number: "АВР-9", date: D("2026-10-20"), status: "ON_APPROVAL", currency: "KGS" } });
  await actLine(act3.id, items["К1:06-01-015"], "Монолитные колонны и стены", 500, 12500, 6250000);

  await prisma.auditLog.create({ data: { userId: actor, projectId: pid, action: "project.create", entityType: "Project", entityId: pid, comment: "Создан демонстрационный проект" } });

  // Пример файла новой версии сметы для проверки импорта
  await writeSampleEstimate();

  console.log(`\nДемо-проект создан: ${project.name}`);
  console.log("Демо-пользователи (пароль для всех):", password);
  for (const r of roles.filter((x) => x.code !== "admin")) console.log(`  demo.${r.code}@example.local — ${r.name}`);
  console.log("Пример файла сметы: samples/demo-estimate-v2.xlsx");
}

async function actLine(actId: string, workItemId: string, description: string, quantity: number, unitPrice: number, amount: number) {
  await prisma.actLine.create({
    data: { actId, description, unit: "м3", quantity, unitPrice, amount, allocations: { create: { workItemId, quantity, amount } } },
  });
}

async function writeSampleEstimate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ЛСР");
  ws.addRow(["СВОДНЫЙ СМЕТНЫЙ РАСЧЁТ — ДЕМО-ДАННЫЕ, ред. 2"]);
  ws.addRow(["Объект: Жилой комплекс «Пример» (вымышленный)"]);
  ws.addRow([]);
  ws.addRow(["№ п/п", "Шифр расценки", "Наименование работ", "Ед. изм.", "Количество", "Цена за ед., сом", "Стоимость, сом", "Корпус", "Этап"]);
  ws.addRow([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  let n = 0;
  let current = "";
  for (const l of LINES) {
    if (l.section !== current) {
      current = l.section;
      ws.addRow([`Раздел ${l.section}. ${l.secName}`]);
    }
    // ред. 2: увеличен объём перекрытий, изменена цена кровли
    const qty = l.code === "06-01-034" ? 2250 : l.qty;
    const price = l.code === "12-01-002" ? 2600 : l.price;
    ws.addRow([++n, l.code, l.name, l.unit, qty, price, l.code === "06-01-001" && l.obj === "К1" ? 7800000 : qty * price, l.obj, l.stage]);
  }
  ws.addRow(["Раздел 7. Благоустройство"]);
  ws.addRow([++n, "47-01-001", "Озеленение территории", "м2", 3000, 450, 1350000, "К1", "Э3"]);
  ws.addRow(["Всего по смете", null, null, null, null, null, null]);
  [8, 14, 44, 8, 12, 14, 16, 8, 8].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const dir = path.resolve("samples");
  await mkdir(dir, { recursive: true });
  await wb.xlsx.writeFile(path.join(dir, "demo-estimate-v2.xlsx"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
