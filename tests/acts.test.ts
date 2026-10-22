/**
 * Интеграционные тесты: договоры, АВР, распознавание по фото (тестовая БД; OCR — локальный Tesseract).
 */
import { beforeAll, describe, expect, inject, it } from "vitest";
import { execSync } from "node:child_process";
import { prisma } from "@/lib/server/db";
import { createProject } from "@/lib/server/services/project";
import { createContract, reviewExtractedField, setAllocationStatus, setContractStatus, setOverAllocation, upsertAllocation } from "@/lib/server/services/contract";
import { changeActStatus, createAct, createCorrection, findDuplicateActs } from "@/lib/server/services/act";
import { confirmRecognition, processRecognition, saveDraft, startRecognition } from "@/lib/server/services/recognition";
import { loadRegistry } from "@/lib/server/registry";
import { loadContracts } from "@/lib/server/contracts";
import { actScan, SAMPLE_ACT } from "./fixtures/actImage";
import type { DraftFields, DraftLine, DraftMatches } from "@/lib/recognition/draft";

const enabled = inject("integrationDb");
const hasTesseract = (() => {
  try {
    execSync("tesseract --list-langs", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

let userId: string;
let projectId: string;
let contractId: string;
const items: Record<string, string> = {};

async function seedProject() {
  const u = await prisma.user.create({ data: { email: `acts-${Date.now()}@test.local`, name: "Тест", passwordHash: "x" } });
  userId = u.id;
  const p = await createProject(userId, { code: `ACT-${Date.now()}`, name: "АВР тест", currency: "KGS" });
  projectId = p.id;
  const v = await prisma.estimateVersion.create({ data: { projectId, versionNumber: 1, name: "v1", status: "ACTIVE", isBaseline: true, currency: "KGS", approvedAt: new Date("2026-01-01") } });
  const defs = [
    ["06-01-015", "Монолитные колонны и стены", "м3", 1000, 12500],
    ["06-01-034", "Монолитные перекрытия", "м3", 1000, 11800],
    ["08-01-003", "Гидроизоляция фундаментов", "м2", 1000, 650],
  ] as const;
  for (const [code, name, unit, qty, price] of defs) {
    const wi = await prisma.workItem.create({ data: { projectId, itemKey: `${code}|${name}`, code, name, unit } });
    items[code] = wi.id;
    await prisma.estimateLine.create({ data: { versionId: v.id, workItemId: wi.id, itemKey: `${code}|${name}`, code, name, unit, quantity: qty, unitPrice: price, currency: "KGS" } });
  }
}

describe.runIf(enabled)("Договоры и АВР", () => {
  beforeAll(async () => {
    await seedProject();
    contractId = await createContract(userId, projectId, { newContractorName: "ОсОО Тест-Монолит", contractorInn: "01234567891011", number: "Д-02/26", date: "2026-03-10", totalAmount: "5000000", currency: "KGS" });
  });

  it("QA-11: договор с отрицательной или нечисловой суммой не создаётся", async () => {
    const before = await prisma.contract.count({ where: { projectId } });
    await expect(createContract(userId, projectId, { newContractorName: "ОсОО Негатив", number: "N-1", totalAmount: "-5000" })).rejects.toThrow(/отрицательн/);
    await expect(createContract(userId, projectId, { newContractorName: "ОсОО Негатив", number: "N-2", totalAmount: "1e99" })).rejects.toThrow(/введите число/);
    expect(await prisma.contract.count({ where: { projectId } })).toBe(before);
  });

  it("договор не действует без проверки извлечённых полей; затем подтверждается", async () => {
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const doc = await prisma.document.create({ data: { projectId, kind: "CONTRACT", originalName: "x.pdf", storagePath: "x", mimeType: "application/pdf", size: 1, sha256: "s", uploadedById: userId } });
    await prisma.extractedField.create({ data: { documentId: doc.id, entityType: "Contract", entityId: c.id, field: "totalAmount", value: "5000000", needsReview: true } });
    await expect(setContractStatus(userId, projectId, contractId, "ACTIVE", null)).rejects.toThrow(/непроверенные/);
    await reviewExtractedField(userId, projectId, contractId, "all");
    await setContractStatus(userId, projectId, contractId, "ACTIVE", null);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })).status).toBe("ACTIVE");
  });

  it("Тест 14: распределение сверх суммы договора — только с исключением", async () => {
    await upsertAllocation(userId, projectId, contractId, { workItemId: items["06-01-015"], quantity: "200", unitPrice: "12500", amount: "" }); // 2 500 000
    await upsertAllocation(userId, projectId, contractId, { workItemId: items["06-01-034"], amount: "2000000" });
    await expect(upsertAllocation(userId, projectId, contractId, { workItemId: items["08-01-003"], amount: "600000" })).rejects.toThrow(/превысит сумму договора/);
    await setOverAllocation(userId, projectId, contractId, true, "Протокол разногласий №1");
    await upsertAllocation(userId, projectId, contractId, { workItemId: items["08-01-003"], amount: "600000" });
    await setOverAllocation(userId, projectId, contractId, false, null);
    const allocs = await prisma.contractWorkAllocation.findMany({ where: { contractId } });
    for (const a of allocs.filter((x) => x.workItemId !== items["08-01-003"])) await setAllocationStatus(userId, projectId, a.id, "CONFIRMED");
    // подтверждение распределения сверх лимита после снятия исключения невозможно
    const over = allocs.find((x) => x.workItemId === items["08-01-003"])!;
    await expect(setAllocationStatus(userId, projectId, over.id, "CONFIRMED")).rejects.toThrow(/превысит/);
    await setAllocationStatus(userId, projectId, over.id, "DELETE");
    const row = (await loadContracts(projectId)).find((r) => r.id === contractId)!;
    expect(row.allocatedConfirmed).toBe("4500000");
    expect(row.unallocated).toBe("500000");
    const reg = await loadRegistry(projectId);
    expect(reg.rows.find((r) => r.code === "06-01-015")!.covered).toBe(true);
    expect(reg.rows.find((r) => r.code === "08-01-003")!.covered).toBe(false);
  });

  it("Тест 9: корректировочный акт заменяет исходный — без двойного учёта", async () => {
    const actId = await createAct(userId, projectId, { number: "АВР-1", date: "2026-05-05", contractId, currency: "KGS" }, [
      { description: "Колонны", quantity: "80", unitPrice: "12500", amount: "1000000", allocations: [{ workItemId: items["06-01-015"], quantity: "80", amount: "1000000" }] },
    ]);
    const item = () => loadRegistry(projectId, { workItemId: items["06-01-015"] }).then((r) => r.rows[0]);
    expect((await item()).actsAccepted).toBeNull(); // черновик не принят
    expect((await item()).actsPending).toBe("1000000");
    await expect(changeActStatus(userId, projectId, actId, "SIGNED", { comment: null, canOverride: false })).rejects.toThrow(/дату подписания/);
    await changeActStatus(userId, projectId, actId, "SIGNED", { comment: null, signedAt: "2026-05-07", canOverride: false });
    expect((await item()).actsAccepted).toBe("1000000");

    const corrId = await createCorrection(userId, projectId, actId);
    await prisma.actLine.updateMany({ where: { actId: corrId }, data: { amount: 800000, quantity: 64 } });
    await prisma.actLineAllocation.updateMany({ where: { actLine: { actId: corrId } }, data: { amount: 800000, quantity: 64 } });
    // пока корректировка не подписана — учитывается исходный акт
    expect((await item()).actsAccepted).toBe("1000000");
    await changeActStatus(userId, projectId, corrId, "SIGNED", { comment: null, signedAt: "2026-06-01", canOverride: false });
    expect((await prisma.act.findUniqueOrThrow({ where: { id: actId } })).status).toBe("CORRECTED");
    expect((await item()).actsAccepted).toBe("800000");
    // состояние на дату до корректировки воспроизводимо
    const past = await loadRegistry(projectId, { workItemId: items["06-01-015"], asOf: "2026-05-20" });
    expect(past.rows[0].actsAccepted).toBe("1000000");
  });

  it("лимит договора: подписание сверх суммы — только с исключением и правом", async () => {
    const big = await createAct(userId, projectId, { number: "АВР-2", date: "2026-07-01", contractId, currency: "KGS" }, [
      { description: "Перекрытия", amount: "4500000", allocations: [{ workItemId: items["06-01-034"], amount: "4500000" }] },
    ]);
    await expect(changeActStatus(userId, projectId, big, "SIGNED", { comment: null, signedAt: "2026-07-02", canOverride: false })).rejects.toThrow(/Нарушены лимиты/);
    await expect(changeActStatus(userId, projectId, big, "SIGNED", { comment: "ДС в работе", signedAt: "2026-07-02", override: true, canOverride: false })).rejects.toThrow(/права/);
    await changeActStatus(userId, projectId, big, "SIGNED", { comment: "ДС № 3 на согласовании", signedAt: "2026-07-02", override: true, canOverride: true });
    const a = await prisma.act.findUniqueOrThrow({ where: { id: big } });
    expect(a.limitOverride).toBe(true);
  });

  it("дубликат: тот же номер и подрядчик обнаруживается до подписания", async () => {
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const d = await findDuplicateActs(projectId, { number: "ABP-2", date: null, contractorId: c.contractorId, contractId, total: null });
    expect(d[0].number).toBe("АВР-2");
    expect(d[0].strength).toBe("strong");
    const dupId = await createAct(userId, projectId, { number: "АВР 2", date: "2026-07-01", contractId, currency: "KGS" }, [{ description: "x", amount: "1" }]);
    await expect(changeActStatus(userId, projectId, dupId, "SIGNED", { comment: null, signedAt: "2026-07-02", canOverride: true, override: true })).rejects.toThrow(/другой документ/);
  });
});

describe.runIf(enabled && hasTesseract)("Распознавание АВР по фото", () => {
  it("фото → черновик → проверка → подтверждение; показатели меняются только после подписания", async () => {
    const file = new File([new Uint8Array(await actScan(SAMPLE_ACT))], "avr.png", { type: "image/png" });
    const t0 = Date.now();
    const recId = await startRecognition(userId, projectId, [file], { enqueue: false });
    await processRecognition(recId); // в тесте — синхронно, без очереди
    console.log("recognition ms", Date.now() - t0);
    let rec = await prisma.actRecognition.findUniqueOrThrow({ where: { id: recId } });
    expect(rec.status).toBe("NEEDS_REVIEW");
    const fields = rec.fields as unknown as DraftFields;
    const lines = rec.lines as unknown as DraftLine[];
    const matches = rec.matches as unknown as DraftMatches;
    expect(fields.number.value).toBe("АВР-15");
    expect(lines).toHaveLength(4);
    // договор найден по номеру с высокой уверенностью
    expect(matches.contract?.level).toBe("high");
    expect(matches.selectedContractId).toBe(contractId);
    // строка 1 — высокая уверенность, предложение требует подтверждения
    expect(lines[0].match?.level).toBe("high");
    expect(lines[0].allocations[0].workItemId).toBe(items["06-01-015"]);
    expect(lines[0].allocations[0].confirmed).toBe(false);
    // «вывоз мусора» — нет в смете
    expect(lines[3].allocations).toHaveLength(0);
    // оригинал не изменён, подготовленное изображение сохранено отдельно
    const page = await prisma.actRecognitionPage.findFirstOrThrow({ where: { recognitionId: recId }, include: { document: true } });
    expect(page.processedPath).not.toBe(page.document.storagePath);

    // До проверки подтвердить нельзя
    await expect(confirmRecognition(userId, projectId, recId, "DRAFT")).rejects.toThrow(/не отмечена как проверенная/);

    // Пользователь проверяет: подтверждает поля, исправляет сумму строки 4, подтверждает сопоставления
    const f2 = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value ? { ...v, status: "confirmed" } : v]));
    const l2 = lines.map((l, i) => ({
      ...l,
      verified: true,
      cells: i === 3 ? { ...l.cells, amount: { ...l.cells.amount, value: "18 000,00", edited: true, original: l.cells.amount.raw } } : l.cells,
      allocations: l.allocations.map((a) => ({ ...a, confirmed: true })),
      unmatchedAccepted: l.allocations.length === 0,
    }));
    const changes = await saveDraft(userId, projectId, recId, { fields: f2, lines: l2, selectedContractId: contractId, selectedContractorId: matches.selectedContractorId, duplicateDecision: null });
    expect(changes).toBeGreaterThan(0);
    rec = await prisma.actRecognition.findUniqueOrThrow({ where: { id: recId } });
    const saved = rec.lines as unknown as DraftLine[];
    expect(saved[3].cells.amount.value).toBe("18000.00");
    expect(saved[3].cells.amount.original).toBe(lines[3].cells.amount.raw);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: recId, action: "recognition.edit" } });
    expect(JSON.stringify(audit!.after)).toMatch(/amount/);

    const before = (await loadRegistry(projectId, { workItemId: items["06-01-015"] })).rows[0].actsAccepted;
    const actId = await confirmRecognition(userId, projectId, recId, "DRAFT");
    const act = await prisma.act.findUniqueOrThrow({ where: { id: actId }, include: { lines: { include: { allocations: true } } } });
    expect(act.status).toBe("DRAFT"); // никогда не «подписан» автоматически
    expect(act.lines).toHaveLength(4);
    expect(act.lines[3].unmatched).toBe(true);
    expect(act.contractId).toBe(contractId);
    // не созданы платежи, проводки, выполнение
    expect(await prisma.payment.count({ where: { projectId } })).toBe(0);
    expect(await prisma.workProgressRecord.count({ where: { workItem: { projectId } } })).toBe(0);
    expect((await loadRegistry(projectId, { workItemId: items["06-01-015"] })).rows[0].actsAccepted).toBe(before);
    // повторное подтверждение невозможно
    await expect(confirmRecognition(userId, projectId, recId, "DRAFT")).rejects.toThrow(/уже подтверждён/);

    // Повторная загрузка той же фотографии — обнаружен дубликат до создания записи
    const rec2 = await startRecognition(userId, projectId, [new File([new Uint8Array(await actScan(SAMPLE_ACT))], "avr-again.png", { type: "image/png" })], { enqueue: false });
    await processRecognition(rec2);
    const r2 = await prisma.actRecognition.findUniqueOrThrow({ where: { id: rec2 } });
    const dups = r2.duplicates as unknown as { acts: { actId: string; strength: string }[] };
    expect(dups.acts.find((d) => d.actId === actId)?.strength).toBe("exact");
    await expect(confirmRecognition(userId, projectId, rec2, "DRAFT")).rejects.toThrow(/дубликат/);
  }, 180_000);
});
