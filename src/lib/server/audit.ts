import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

const SECRET_KEYS = /password|token|secret|hash/i;

/** Удаляет секретные поля и приводит Decimal/Date к строкам для хранения в JSON. */
function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, v) => (key && SECRET_KEYS.test(key) ? "[скрыто]" : v)),
  ) as Prisma.InputJsonValue;
}

export interface AuditEntry {
  userId: string | null;
  projectId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  comment?: string | null;
}

export async function logAudit(entry: AuditEntry, tx: Prisma.TransactionClient = prisma) {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      projectId: entry.projectId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: sanitize(entry.before),
      after: sanitize(entry.after),
      comment: entry.comment ?? null,
    },
  });
}
