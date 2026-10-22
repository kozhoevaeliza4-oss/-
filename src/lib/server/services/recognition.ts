import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";
import { readDocument, saveUpload, storageRoot } from "../storage";
import { pdfToImages } from "../ocr/tools";
import { prepareImage, tesseractEngine } from "../ocr/engine";
import { createAct, findDuplicateActs } from "./act";
import { ACT_FIELDS, ActFieldKey, LINE_COLUMNS, parseActPages, RecLine } from "@/lib/extract/act";
import type { OcrPage } from "@/lib/extract/ocrTypes";
import { checkActArithmetic } from "@/lib/calc/actChecks";
import { ItemCandidate, matchContract, matchLine } from "@/lib/extract/match";
import { confirmBlockers, DraftChecks, DraftFields, DraftLine, DraftMatches, NUMERIC_COLUMNS } from "@/lib/recognition/draft";
import { dec, sumKnown } from "@/lib/calc/decimal";
import { plannedCost } from "@/lib/calc/workItem";
import { normalizeNumber, parseDocDate } from "@/lib/extract/normalize";

export const RECOGNITION_EXTENSIONS = ["jpg", "jpeg", "png", "heic", "heif", "pdf"];
const MAX_FILES = 20;
const STALE_MS = 15 * 60 * 1000;

// ───────────── Очередь обработки (в пределах процесса, по одному документу) ─────────────

const g = globalThis as unknown as { __recQueue?: { chain: Promise<void>; active: Set<string> } };
const queue = (g.__recQueue ??= { chain: Promise.resolve(), active: new Set() });

export function enqueueRecognition(id: string) {
  if (queue.active.has(id)) return;
  queue.active.add(id);
  queue.chain = queue.chain
    .then(() => processRecognition(id))
    .catch((e) => console.error("Recognition failed:", e instanceof Error ? e.message : e))
    .finally(() => queue.active.delete(id));
}

export function isQueued(id: string) {
  return queue.active.has(id);
}

// ───────────── Загрузка ─────────────

function filesFrom(list: File[]): File[] {
  const files = list.filter((f) => f && typeof f !== "string" && f.size > 0);
  if (!files.length) throw new UserError("Добавьте хотя бы одну фотографию или файл");
  if (files.length > MAX_FILES) throw new UserError(`Не более ${MAX_FILES} файлов за один раз`);
  return files;
}

/** Сохраняет оригиналы (без изменений) и ставит документ в очередь распознавания. */
export async function startRecognition(userId: string, projectId: string, list: File[], opts: { enqueue?: boolean } = {}): Promise<string> {
  const files = filesFrom(list);
  const docs = [];
  for (const f of files) docs.push(await saveUpload({ file: f, projectId, kind: "ACT", userId, allowed: RECOGNITION_EXTENSIONS }));
  const rec = await prisma.actRecognition.create({
    data: {
      projectId,
      status: "QUEUED",
      createdById: userId,
      progressText: "Ожидает распознавания",
      pages: { create: docs.map((d, i) => ({ documentId: d.id, sortOrder: i })) },
    },
  });
  await logAudit({ userId, projectId, action: "recognition.upload", entityType: "ActRecognition", entityId: rec.id, after: { files: docs.map((d) => d.originalName) } });
  if (opts.enqueue !== false) enqueueRecognition(rec.id);
  return rec.id;
}

export async function addRecognitionPages(userId: string, projectId: string, id: string, list: File[]) {
  const rec = await prisma.actRecognition.findFirst({ where: { id, projectId }, include: { pages: true } });
  if (!rec) throw new UserError("Документ не найден");
  if (rec.status === "CONFIRMED" || rec.status === "CANCELLED") throw new UserError("Документ уже обработан");
  const files = filesFrom(list);
  let order = Math.max(-1, ...rec.pages.map((p) => p.sortOrder)) + 1;
  for (const f of files) {
    const d = await saveUpload({ file: f, projectId, kind: "ACT", userId, allowed: RECOGNITION_EXTENSIONS });
    await prisma.actRecognitionPage.create({ data: { recognitionId: id, documentId: d.id, sortOrder: order++ } });
  }
  await logAudit({ userId, projectId, action: "recognition.addPages", entityType: "ActRecognition", entityId: id, after: { files: files.map((f) => f.name) } });
}

/** Повторное распознавание: исправления пользователя в черновике заменяются новым результатом (журнал сохраняется). */
export async function retryRecognition(userId: string, projectId: string, id: string) {
  const rec = await prisma.actRecognition.findFirst({ where: { id, projectId } });
  if (!rec) throw new UserError("Документ не найден");
  if (rec.status === "CONFIRMED" || rec.status === "CANCELLED") throw new UserError("Документ уже обработан");
  if (rec.status === "RECOGNIZING" && Date.now() - rec.updatedAt.getTime() < STALE_MS && isQueued(id)) throw new UserError("Распознавание уже выполняется");
  await prisma.actRecognition.update({ where: { id }, data: { status: "QUEUED", progress: 0, progressText: "Ожидает распознавания", error: null } });
  await logAudit({ userId, projectId, action: "recognition.retry", entityType: "ActRecognition", entityId: id });
  enqueueRecognition(id);
}

/** Распознавание не удалось или недоступно — пустой черновик для ручного ввода (оригинал сохранён). */
export async function startManualEntry(userId: string, projectId: string, id: string) {
  const rec = await prisma.actRecognition.findFirst({ where: { id, projectId } });
  if (!rec) throw new UserError("Документ не найден");
  if (rec.status === "CONFIRMED" || rec.status === "CANCELLED") throw new UserError("Документ уже обработан");
  const fields = (rec.fields as unknown as DraftFields | null) ?? emptyFields();
  await prisma.actRecognition.update({
    where: { id },
    data: { status: "NEEDS_REVIEW", fields: fields as unknown as Prisma.InputJsonValue, lines: (rec.lines ?? []) as Prisma.InputJsonValue, progressText: "Ручной ввод" },
  });
  await logAudit({ userId, projectId, action: "recognition.manual", entityType: "ActRecognition", entityId: id });
}

export async function cancelRecognition(userId: string, projectId: string, id: string, reason: string | null) {
  const rec = await prisma.actRecognition.findFirst({ where: { id, projectId } });
  if (!rec) throw new UserError("Документ не найден");
  if (rec.status === "CONFIRMED") throw new UserError("Документ уже подтверждён — аннулируйте акт");
  await prisma.actRecognition.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
  await logAudit({ userId, projectId, action: "recognition.cancel", entityType: "ActRecognition", entityId: id, comment: reason });
}

function emptyFields(): DraftFields {
  return Object.fromEntries(Object.keys(ACT_FIELDS).map((k) => [k, { raw: null, value: null, confidence: null, bbox: null, status: "not_found" }])) as DraftFields;
}

// ───────────── Обработка ─────────────

function processedPath(projectId: string, pageId: string) {
  return path.join(projectId, "processed", `${pageId}.png`);
}

async function setProgress(id: string, progress: number, text: string) {
  await prisma.actRecognition.update({ where: { id }, data: { progress, progressText: text } });
}

export async function processRecognition(id: string) {
  const rec = await prisma.actRecognition.findUnique({ where: { id }, include: { pages: { include: { document: true }, orderBy: { sortOrder: "asc" } } } });
  if (!rec) return;
  // Атомарный захват: документ обрабатывается только одним исполнителем
  const claimed = await prisma.actRecognition.updateMany({
    where: { id, status: "QUEUED" },
    data: { status: "RECOGNIZING", startedAt: new Date(), progress: 1, progressText: "Подготовка", error: null },
  });
  if (claimed.count === 0) return;
  try {
    const av = await tesseractEngine.available();
    if (!av.ok) throw new UserError(`${av.reason}. Оригинал сохранён — введите данные вручную.`);

    // PDF → отдельные страницы
    let pages = rec.pages;
    for (const p of rec.pages) {
      if (!/\.pdf$/i.test(p.document.originalName) || p.sourcePage !== null) continue;
      await setProgress(id, 3, "Разбивка PDF на страницы");
      const images = await pdfToImages(await readDocument(p.document.storagePath), 300, 30);
      if (!images.length) throw new UserError("В PDF нет страниц");
      await prisma.actRecognitionPage.update({ where: { id: p.id }, data: { sourcePage: 1 } });
      // сдвигаем порядок последующих страниц
      await prisma.actRecognitionPage.updateMany({ where: { recognitionId: id, sortOrder: { gt: p.sortOrder } }, data: { sortOrder: { increment: images.length - 1 } } });
      for (let k = 1; k < images.length; k++)
        await prisma.actRecognitionPage.create({ data: { recognitionId: id, documentId: p.documentId, sortOrder: p.sortOrder + k, sourcePage: k + 1 } });
    }
    pages = await prisma.actRecognitionPage.findMany({ where: { recognitionId: id }, include: { document: true }, orderBy: { sortOrder: "asc" } });

    const ocrPages: OcrPage[] = [];
    const notes: string[] = [];
    const pdfCache = new Map<string, Buffer[]>();
    for (const [i, p] of pages.entries()) {
      await setProgress(id, 5 + Math.round((i / pages.length) * 80), `Распознавание страницы ${i + 1} из ${pages.length}`);
      try {
        let input: Buffer;
        let name = p.document.originalName;
        if (p.sourcePage !== null && /\.pdf$/i.test(name)) {
          if (!pdfCache.has(p.documentId)) pdfCache.set(p.documentId, await pdfToImages(await readDocument(p.document.storagePath), 300, 30));
          input = pdfCache.get(p.documentId)![p.sourcePage - 1];
          name = "page.png";
        } else input = await readDocument(p.document.storagePath);
        const prepared = await prepareImage(input, name);
        const rel = processedPath(rec.projectId, p.id);
        await mkdir(path.dirname(path.join(storageRoot(), rel)), { recursive: true });
        await writeFile(path.join(storageRoot(), rel), prepared.png, { mode: 0o600 });
        const page = await tesseractEngine.recognize(prepared.png);
        ocrPages.push(page);
        notes.push(...prepared.notes.map((n) => `Стр. ${i + 1}: ${n}`));
        await prisma.actRecognitionPage.update({
          where: { id: p.id },
          data: { processedPath: rel, width: page.width, height: page.height, rotation: prepared.rotation, meanConfidence: page.meanConfidence, words: page.words as unknown as Prisma.InputJsonValue, error: null },
        });
        if (page.meanConfidence !== null && page.meanConfidence < 60) notes.push(`Стр. ${i + 1}: низкое качество распознавания (${Math.round(page.meanConfidence)}%) — проверьте значения внимательно или переснимите страницу`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await prisma.actRecognitionPage.update({ where: { id: p.id }, data: { error: msg } });
        ocrPages.push({ width: 0, height: 0, words: [], meanConfidence: null });
        notes.push(`Стр. ${i + 1}: не распознана (${msg})`);
      }
    }

    await setProgress(id, 88, "Извлечение реквизитов и таблицы");
    const parsed = parseActPages(ocrPages);
    const lines: DraftLine[] = parsed.lines.map(toDraftLine);
    const fields = parsed.fields as DraftFields;
    const draft = await analyzeDraft(rec.projectId, id, fields, lines, null, { hasCharges: parsed.hasCharges, warnings: parsed.warnings, preprocessing: notes });
    await setProgress(id, 97, "Сопоставление и поиск дубликатов");
    await prisma.actRecognition.update({
      where: { id },
      data: {
        status: "NEEDS_REVIEW",
        progress: 100,
        progressText: "Требует проверки",
        ocrProvider: tesseractEngine.name,
        rawText: parsed.fullText,
        fields: fields as unknown as Prisma.InputJsonValue,
        lines: draft.lines as unknown as Prisma.InputJsonValue,
        checks: draft.checks as unknown as Prisma.InputJsonValue,
        matches: draft.matches as unknown as Prisma.InputJsonValue,
        duplicates: draft.duplicates as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    await logAudit({ userId: null, projectId: rec.projectId, action: "recognition.done", entityType: "ActRecognition", entityId: id, after: { pages: pages.length, lines: lines.length, warnings: parsed.warnings } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.actRecognition.update({ where: { id }, data: { status: "FAILED", error: msg, progressText: "Ошибка распознавания", finishedAt: new Date() } });
    await logAudit({ userId: null, projectId: rec.projectId, action: "recognition.failed", entityType: "ActRecognition", entityId: id, comment: msg });
  }
}

function toDraftLine(l: RecLine): DraftLine {
  return {
    key: l.key,
    page: l.page,
    bbox: l.bbox,
    section: l.section,
    cells: Object.fromEntries(LINE_COLUMNS.map((c) => [c, { ...l.cells[c], original: l.cells[c].raw }])) as DraftLine["cells"],
    verified: false,
    allocations: [],
    match: null,
    unmatchedAccepted: false,
  };
}

/**
 * Проверки и предложения для черновика: арифметика, договор/подрядчик, статьи для строк, дубликаты.
 * Выбор пользователя (подтверждённые сопоставления, выбранный договор) сохраняется.
 */
export async function analyzeDraft(
  projectId: string,
  recognitionId: string,
  fields: DraftFields,
  lines: DraftLine[],
  prevMatches: DraftMatches | null,
  extra: { hasCharges: boolean; warnings: string[]; preprocessing: string[] },
) {
  const [contracts, contractors, items, active, pages] = await Promise.all([
    prisma.contract.findMany({ where: { projectId }, include: { contractor: true } }),
    prisma.contractor.findMany(),
    prisma.workItem.findMany({ where: { projectId }, include: { object: true } }),
    prisma.estimateVersion.findFirst({ where: { projectId, status: "ACTIVE" } }),
    prisma.actRecognitionPage.findMany({ where: { recognitionId }, include: { document: { select: { sha256: true } } } }),
  ]);
  const contractMatch = matchContract(
    { contractNumber: fields.contractNumber?.value ?? null, contractDate: fields.contractDate?.value ?? null, contractorName: fields.contractorName?.value ?? null, contractorInn: fields.contractorInn?.value ?? null },
    contracts.map((c) => ({ id: c.id, number: c.number, date: c.date?.toISOString().slice(0, 10) ?? null, contractorId: c.contractorId, contractorName: c.contractor?.name ?? null, contractorInn: c.contractor?.inn ?? null, status: c.status })),
    contractors,
  );
  const selectedContractId = prevMatches?.selectedContractId ?? (contractMatch.level === "high" ? contractMatch.suggestions[0]?.contractId ?? null : null);
  const selectedContract = contracts.find((c) => c.id === selectedContractId);
  const selectedContractorId = prevMatches?.selectedContractorId ?? selectedContract?.contractorId ?? contractMatch.contractorId;

  const estLines = active ? await prisma.estimateLine.findMany({ where: { versionId: active.id, workItemId: { not: null } } }) : [];
  const priceByItem = new Map(estLines.map((l) => [l.workItemId!, l.unitPrice?.toString() ?? (plannedCost({ quantity: dec(l.quantity), unitPrice: null, sourceTotal: dec(l.sourceTotal) }).value && l.quantity ? dec(l.sourceTotal)!.div(dec(l.quantity)!).toFixed(2) : null)]));
  const contractAllocs = selectedContractId ? await prisma.contractWorkAllocation.findMany({ where: { contractId: selectedContractId, status: { not: "REJECTED" } } }) : [];
  const allocByItem = new Map(contractAllocs.map((a) => [a.workItemId, a]));
  const candidates: ItemCandidate[] = items.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    unit: i.unit,
    objectCode: i.object?.code ?? null,
    plannedPrice: priceByItem.get(i.id) ?? null,
    inContract: allocByItem.has(i.id),
    contractPrice: allocByItem.get(i.id)?.unitPrice?.toString() ?? null,
  }));

  const outLines = lines.map((l) => {
    const match = matchLine(
      { code: l.cells.code.value, name: l.cells.name.value, unit: l.cells.unit.value, unitPrice: l.cells.unitPrice.value },
      candidates,
      { objectHint: fields.objectText?.value ?? fields.projectName?.value ?? null },
    );
    let allocations = l.allocations;
    // Высокая уверенность — предлагаем статью (требует подтверждения пользователем)
    if (!allocations.length && !l.unmatchedAccepted && match.level === "high") {
      const s = match.suggestions[0];
      allocations = [{ workItemId: s.workItemId, label: s.label, quantity: l.cells.quantity.value, amount: l.cells.amount.value, confirmed: false }];
    }
    return { ...l, match, allocations };
  });

  const arithmetic = checkActArithmetic({
    lines: outLines.map((l) => ({ quantity: l.cells.quantity.value, unitPrice: l.cells.unitPrice.value, amount: l.cells.amount.value })),
    subtotal: fields.subtotal?.value ?? null,
    vatAmount: fields.vatAmount?.value ?? null,
    total: fields.total?.value ?? null,
    amountInWords: fields.amountInWords?.value ?? null,
    hasCharges: extra.hasCharges,
  });
  const total = sumKnown(outLines.map((l) => dec(l.cells.amount.value))).sum;
  const duplicates = await findDuplicateActs(projectId, {
    number: fields.number?.value ?? null,
    date: fields.date?.value ?? null,
    contractorId: selectedContractorId,
    contractId: selectedContractId,
    total: total?.toFixed(2) ?? null,
    objectText: fields.objectText?.value ?? null,
    sha256s: pages.map((p) => p.document.sha256),
  });
  // другие черновики распознавания с той же фотографией
  const otherRecs = await prisma.actRecognition.findMany({
    where: { projectId, id: { not: recognitionId }, status: { notIn: ["CANCELLED", "CONFIRMED"] }, pages: { some: { document: { sha256: { in: pages.map((p) => p.document.sha256) } } } } },
    select: { id: true, createdAt: true },
  });
  const checks: DraftChecks = { arithmetic, warnings: extra.warnings, hasCharges: extra.hasCharges, preprocessing: extra.preprocessing };
  const matches: DraftMatches = { contract: contractMatch, selectedContractId, selectedContractorId };
  return { lines: outLines, checks, matches, duplicates: { acts: duplicates, recognitions: otherRecs.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString() })) } };
}

// ───────────── Правки пользователя ─────────────

const cellSchema = z.object({ raw: z.string().nullable(), value: z.string().nullable(), confidence: z.number().nullable(), corrected: z.boolean().optional(), original: z.string().nullish(), edited: z.boolean().optional() });
const draftSchema = z.object({
  fields: z.record(z.string(), z.object({ raw: z.string().nullable(), value: z.string().nullable(), confidence: z.number().nullable(), bbox: z.any().nullable(), status: z.enum(["recognized", "low_confidence", "not_found", "edited", "confirmed"]), corrected: z.boolean().optional(), original: z.string().nullish() })),
  lines: z.array(
    z.object({
      key: z.string(),
      page: z.number().nullable(),
      bbox: z.any().nullable(),
      section: z.string().nullable(),
      cells: z.object(Object.fromEntries(LINE_COLUMNS.map((c) => [c, cellSchema])) as Record<(typeof LINE_COLUMNS)[number], typeof cellSchema>),
      verified: z.boolean(),
      manual: z.boolean().optional(),
      allocations: z.array(z.object({ workItemId: z.string(), label: z.string(), quantity: z.string().nullable(), amount: z.string().nullable(), confirmed: z.boolean() })),
      match: z.any().nullable(),
      unmatchedAccepted: z.boolean(),
    }),
  ),
  selectedContractId: z.string().nullable(),
  selectedContractorId: z.string().nullable(),
  duplicateDecision: z.string().nullable(),
});

export type DraftPayload = z.infer<typeof draftSchema>;

/** Нормализация значений после правки: числа и даты приводятся к единому виду, исходное значение сохраняется. */
function normalizeEdits(d: DraftPayload) {
  for (const [k, f] of Object.entries(d.fields)) {
    if (f.status !== "edited" || f.value === null) continue;
    if (["date", "periodFrom", "periodTo", "contractDate"].includes(k)) {
      const v = /^\d{4}-\d{2}-\d{2}$/.test(f.value) ? f.value : parseDocDate(f.value);
      if (!v) throw new UserError(`«${ACT_FIELDS[k as ActFieldKey]}»: некорректная дата`);
      f.value = v;
    }
    if (["subtotal", "vatAmount", "total"].includes(k)) {
      const n = normalizeNumber(f.value);
      if (!n.ok) throw new UserError(`«${ACT_FIELDS[k as ActFieldKey]}»: введите число`);
      f.value = n.value;
    }
  }
  d.lines.forEach((l, i) => {
    for (const c of NUMERIC_COLUMNS) {
      const cell = l.cells[c];
      if (!cell.edited || cell.value === null || cell.value === "") {
        if (cell.value === "") cell.value = null;
        continue;
      }
      const n = normalizeNumber(cell.value);
      if (!n.ok) throw new UserError(`Строка ${i + 1}: «${c}» — введите число`);
      cell.value = n.value;
    }
    for (const a of l.allocations) {
      const n = normalizeNumber(a.amount);
      if (!n.ok) throw new UserError(`Строка ${i + 1}: сумма распределения — введите число`);
      a.amount = n.value;
      const q = normalizeNumber(a.quantity);
      a.quantity = q.ok ? q.value : null;
    }
  });
}

function describeChanges(prevFields: DraftFields, prevLines: DraftLine[], next: DraftPayload) {
  const changes: string[] = [];
  for (const k of Object.keys(ACT_FIELDS) as ActFieldKey[]) {
    const a = prevFields[k]?.value ?? null;
    const b = (next.fields[k]?.value as string | null) ?? null;
    if (a !== b) changes.push(`${ACT_FIELDS[k]}: «${a ?? ""}» → «${b ?? ""}»`);
    else if (prevFields[k]?.status !== next.fields[k]?.status && next.fields[k]?.status === "confirmed") changes.push(`${ACT_FIELDS[k]}: подтверждено`);
  }
  const prevByKey = new Map(prevLines.map((l) => [l.key, l]));
  const nextKeys = new Set(next.lines.map((l) => l.key));
  for (const l of prevLines) if (!nextKeys.has(l.key)) changes.push(`Удалена строка «${l.cells.name.value ?? ""}»`);
  for (const l of next.lines) {
    const p = prevByKey.get(l.key);
    if (!p) {
      changes.push(`Добавлена строка «${l.cells.name.value ?? ""}»`);
      continue;
    }
    for (const c of LINE_COLUMNS) if ((p.cells[c].value ?? null) !== (l.cells[c].value ?? null)) changes.push(`Строка «${l.cells.name.value ?? ""}»: ${c} «${p.cells[c].value ?? ""}» → «${l.cells[c].value ?? ""}»`);
    const pa = JSON.stringify(p.allocations.map((a) => [a.workItemId, a.amount, a.confirmed]));
    const na = JSON.stringify(l.allocations.map((a) => [a.workItemId, a.amount, a.confirmed]));
    if (pa !== na) changes.push(`Строка «${l.cells.name.value ?? ""}»: изменено сопоставление`);
    if (p.verified !== l.verified && l.verified) changes.push(`Строка «${l.cells.name.value ?? ""}»: проверена`);
  }
  return changes;
}

export async function saveDraft(userId: string, projectId: string, id: string, payload: unknown) {
  const rec = await prisma.actRecognition.findFirst({ where: { id, projectId } });
  if (!rec) throw new UserError("Документ не найден");
  if (!["NEEDS_REVIEW", "REVIEWED"].includes(rec.status)) throw new UserError("Черновик недоступен для редактирования в текущем статусе");
  const r = draftSchema.safeParse(payload);
  if (!r.success) throw new UserError("Некорректные данные черновика");
  const d = r.data;
  normalizeEdits(d);
  if (d.selectedContractId && !(await prisma.contract.findFirst({ where: { id: d.selectedContractId, projectId } }))) throw new UserError("Договор не найден");
  const prevFields = (rec.fields as unknown as DraftFields) ?? emptyFields();
  const prevLines = (rec.lines as unknown as DraftLine[]) ?? [];
  const changes = describeChanges(prevFields, prevLines, d);
  const prevChecks = rec.checks as unknown as DraftChecks | null;
  const analysis = await analyzeDraft(projectId, id, d.fields as DraftFields, d.lines as DraftLine[], { contract: null, selectedContractId: d.selectedContractId, selectedContractorId: d.selectedContractorId }, {
    hasCharges: prevChecks?.hasCharges ?? false,
    warnings: prevChecks?.warnings ?? [],
    preprocessing: prevChecks?.preprocessing ?? [],
  });
  await prisma.actRecognition.update({
    where: { id },
    data: {
      status: "REVIEWED",
      fields: d.fields as unknown as Prisma.InputJsonValue,
      lines: analysis.lines as unknown as Prisma.InputJsonValue,
      checks: analysis.checks as unknown as Prisma.InputJsonValue,
      matches: analysis.matches as unknown as Prisma.InputJsonValue,
      duplicates: analysis.duplicates as unknown as Prisma.InputJsonValue,
      duplicateDecision: d.duplicateDecision,
    },
  });
  if (changes.length || d.duplicateDecision !== rec.duplicateDecision)
    await logAudit({ userId, projectId, action: "recognition.edit", entityType: "ActRecognition", entityId: id, after: { changes, duplicateDecision: d.duplicateDecision } });
  return changes.length;
}

// ───────────── Подтверждение ─────────────

/**
 * Создание АВР из проверенного черновика. Акт создаётся в статусе «черновик» или «на согласовании» —
 * никогда «подписан». Платёж, проводка и физическое выполнение не создаются.
 */
export async function confirmRecognition(userId: string, projectId: string, id: string, status: "DRAFT" | "ON_APPROVAL"): Promise<string> {
  const rec = await prisma.actRecognition.findFirst({ where: { id, projectId }, include: { pages: { orderBy: { sortOrder: "asc" } } } });
  if (!rec) throw new UserError("Документ не найден");
  if (rec.status === "CONFIRMED") throw new UserError("Документ уже подтверждён");
  if (!["NEEDS_REVIEW", "REVIEWED"].includes(rec.status)) throw new UserError("Документ ещё не готов к подтверждению");
  const fields = rec.fields as unknown as DraftFields;
  const lines = (rec.lines as unknown as DraftLine[]) ?? [];
  const matches = rec.matches as unknown as DraftMatches | null;
  const dups = rec.duplicates as unknown as { acts: unknown[]; recognitions: unknown[] } | null;
  const blockers = confirmBlockers(fields, lines, { duplicatesFound: !!(dups && (dups.acts.length || dups.recognitions.length)), duplicateDecision: rec.duplicateDecision });
  if (blockers.length) throw new UserError(blockers.map((b) => b.text).join("; "));
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  const actId = await prisma.$transaction(
    async (tx) => {
      // защита от двойного подтверждения при повторном запросе
      const locked = await tx.actRecognition.updateMany({ where: { id, status: { in: ["NEEDS_REVIEW", "REVIEWED"] } }, data: { status: "CONFIRMED" } });
      if (locked.count === 0) throw new UserError("Документ уже подтверждается или подтверждён");
      const newActId = await createAct(
        userId,
        projectId,
        {
          number: fields.number.value,
          date: fields.date.value,
          periodFrom: fields.periodFrom?.value,
          periodTo: fields.periodTo?.value,
          contractId: matches?.selectedContractId ?? null,
          contractorId: matches?.selectedContractorId ?? null,
          currency: fields.currency?.value ?? project.currency,
          customerName: fields.customerName?.value,
          contractorName: fields.contractorName?.value,
          contractorInn: fields.contractorInn?.value,
          contractText: [fields.contractNumber?.value && `№ ${fields.contractNumber.value}`, fields.contractDate?.value && `от ${fields.contractDate.value}`].filter(Boolean).join(" ") || null,
          objectText: [fields.projectName?.value, fields.objectText?.value].filter(Boolean).join("; ") || null,
          documentTotal: fields.total?.value,
          vatAmount: fields.vatAmount?.value,
          amountInWords: fields.amountInWords?.raw ?? null,
          signatories: fields.signatories?.value,
          comment: `Создан по распознанному документу (${rec.pages.length} стр.)`,
        },
        lines.map((l) => ({
          lineNo: l.cells.lineNo.value,
          code: l.cells.code.value,
          description: l.cells.name.value ?? "",
          unit: l.cells.unit.value,
          quantity: l.cells.quantity.value,
          unitPrice: l.cells.unitPrice.value,
          amount: l.cells.amount.value,
          pageNumber: l.page,
          note: l.unmatchedAccepted ? "Не найдено соответствие в смете/договоре — требуется решение" : null,
          allocations: l.allocations.map((a) => ({ workItemId: a.workItemId, quantity: a.quantity, amount: a.amount })),
        })),
        { documentId: rec.pages[0]?.documentId ?? null, duplicateDecision: rec.duplicateDecision, status, tx },
      );
      await tx.actRecognition.update({ where: { id }, data: { actId: newActId, finishedAt: new Date(), progressText: "Подтверждён и сохранён" } });
      await logAudit({ userId, projectId, action: "recognition.confirm", entityType: "ActRecognition", entityId: id, after: { actId: newActId, status } }, tx);
      return newActId;
    },
    { timeout: 60_000 },
  );
  return actId;
}

/** При открытии страницы: восстановление очереди после перезапуска сервера. */
export async function resumeIfNeeded(id: string) {
  const rec = await prisma.actRecognition.findUnique({ where: { id } });
  if (!rec) return;
  if (rec.status === "QUEUED" && !isQueued(id)) enqueueRecognition(id);
  if (rec.status === "RECOGNIZING" && !isQueued(id) && Date.now() - rec.updatedAt.getTime() > 60_000) {
    await prisma.actRecognition.update({ where: { id }, data: { status: "FAILED", error: "Распознавание было прервано (перезапуск сервера). Повторите распознавание." } });
  }
}
