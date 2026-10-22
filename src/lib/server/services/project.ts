import "server-only";
import { z } from "zod";
import { prisma } from "../db";
import { logAudit } from "../audit";
import { UserError } from "../action";

const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? new Date(v + "T00:00:00Z") : null))
  .refine((d) => d === null || !isNaN(d.getTime()), "Некорректная дата");

export const projectSchema = z.object({
  code: z.string().trim().min(1, "Укажите код").max(40),
  name: z.string().trim().min(1, "Укажите название").max(300),
  description: z.string().trim().max(5000).optional().transform((v) => v || null),
  address: z.string().trim().max(500).optional().transform((v) => v || null),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Код валюты ISO из 3 букв"),
});

export async function createProject(userId: string, input: z.input<typeof projectSchema>) {
  const data = parse(projectSchema, input);
  if (await prisma.project.findUnique({ where: { code: data.code } })) throw new UserError("Проект с таким кодом уже существует");
  const project = await prisma.project.create({ data });
  await logAudit({ userId, projectId: project.id, action: "project.create", entityType: "Project", entityId: project.id, after: data });
  return project;
}

export async function updateProject(userId: string, projectId: string, input: Omit<z.input<typeof projectSchema>, "currency">) {
  const data = parse(projectSchema.omit({ currency: true }), input);
  const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const dup = await prisma.project.findFirst({ where: { code: data.code, NOT: { id: projectId } } });
  if (dup) throw new UserError("Проект с таким кодом уже существует");
  await prisma.project.update({ where: { id: projectId }, data });
  await logAudit({ userId, projectId, action: "project.update", entityType: "Project", entityId: projectId, before: pick(before, data), after: data });
}

/** Подтверждение методики учёта себестоимости 1С и модели прогноза — финансовое решение, фиксируется в журнале. */
export async function updateFinanceSettings(
  userId: string,
  projectId: string,
  input: { costMethodologyConfirmed: boolean; costMethodologyNote: string | null; forecastModelConfirmed: boolean },
) {
  const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (input.costMethodologyConfirmed && !input.costMethodologyNote?.trim())
    throw new UserError("Опишите согласованную методику (счета, виды операций, кем согласовано)");
  await prisma.project.update({ where: { id: projectId }, data: input });
  await logAudit({
    userId,
    projectId,
    action: "project.financeSettings",
    entityType: "Project",
    entityId: projectId,
    before: {
      costMethodologyConfirmed: before.costMethodologyConfirmed,
      costMethodologyNote: before.costMethodologyNote,
      forecastModelConfirmed: before.forecastModelConfirmed,
    },
    after: input,
  });
}

// ───── Корпуса и этапы

export const objectSchema = z.object({
  code: z.string().trim().min(1, "Укажите код").max(40),
  name: z.string().trim().min(1, "Укажите название").max(300),
  sortOrder: z.coerce.number().int().default(0),
});

export async function upsertObject(userId: string, projectId: string, id: string | null, input: z.input<typeof objectSchema>) {
  const data = parse(objectSchema, input);
  const dup = await prisma.constructionObject.findFirst({ where: { projectId, code: data.code, ...(id ? { NOT: { id } } : {}) } });
  if (dup) throw new UserError("Корпус с таким кодом уже есть");
  if (id) {
    const before = await prisma.constructionObject.findFirstOrThrow({ where: { id, projectId } });
    await prisma.constructionObject.update({ where: { id }, data });
    await logAudit({ userId, projectId, action: "object.update", entityType: "ConstructionObject", entityId: id, before, after: data });
  } else {
    const o = await prisma.constructionObject.create({ data: { ...data, projectId } });
    await logAudit({ userId, projectId, action: "object.create", entityType: "ConstructionObject", entityId: o.id, after: data });
  }
}

export const stageSchema = z.object({
  code: z.string().trim().min(1, "Укажите код").max(40),
  name: z.string().trim().min(1, "Укажите название").max(300),
  objectId: z.string().optional().transform((v) => v || null),
  sortOrder: z.coerce.number().int().default(0),
  plannedStart: optDate,
  plannedEnd: optDate,
});

export async function upsertStage(userId: string, projectId: string, id: string | null, input: z.input<typeof stageSchema>) {
  const data = parse(stageSchema, input);
  if (data.plannedStart && data.plannedEnd && data.plannedEnd < data.plannedStart)
    throw new UserError("Дата окончания раньше даты начала");
  if (data.objectId) await prisma.constructionObject.findFirstOrThrow({ where: { id: data.objectId, projectId } });
  const dup = await prisma.constructionStage.findFirst({ where: { projectId, code: data.code, ...(id ? { NOT: { id } } : {}) } });
  if (dup) throw new UserError("Этап с таким кодом уже есть");
  if (id) {
    const before = await prisma.constructionStage.findFirstOrThrow({ where: { id, projectId } });
    await prisma.constructionStage.update({ where: { id }, data });
    await logAudit({ userId, projectId, action: "stage.update", entityType: "ConstructionStage", entityId: id, before, after: data });
  } else {
    const s = await prisma.constructionStage.create({ data: { ...data, projectId } });
    await logAudit({ userId, projectId, action: "stage.create", entityType: "ConstructionStage", entityId: s.id, after: data });
  }
}

export async function deleteObject(userId: string, projectId: string, id: string) {
  const o = await prisma.constructionObject.findFirstOrThrow({ where: { id, projectId }, include: { _count: { select: { workItems: true, stages: true } } } });
  if (o._count.workItems > 0 || o._count.stages > 0) throw new UserError("Нельзя удалить корпус, к которому привязаны статьи или этапы");
  await prisma.constructionObject.delete({ where: { id } });
  await logAudit({ userId, projectId, action: "object.delete", entityType: "ConstructionObject", entityId: id, before: o });
}

export async function deleteStage(userId: string, projectId: string, id: string) {
  const s = await prisma.constructionStage.findFirstOrThrow({ where: { id, projectId }, include: { _count: { select: { workItems: true } } } });
  if (s._count.workItems > 0) throw new UserError("Нельзя удалить этап, к которому привязаны статьи");
  await prisma.constructionStage.delete({ where: { id } });
  await logAudit({ userId, projectId, action: "stage.delete", entityType: "ConstructionStage", entityId: id, before: s });
}

// ───── helpers

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of r.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    throw new UserError(Object.values(fieldErrors)[0] ?? "Проверьте введённые данные", fieldErrors);
  }
  return r.data;
}

function pick<T extends object>(obj: T, keysFrom: object): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(keysFrom)) (out as Record<string, unknown>)[k] = (obj as Record<string, unknown>)[k];
  return out;
}
