import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    integrationDb: boolean;
  }
}

/**
 * Готовит тестовую БД: применяет миграции и очищает таблицы.
 * Работает только с базой, имя которой оканчивается на «_test», — рабочие данные не затрагиваются.
 * Если БД недоступна, интеграционные тесты пропускаются.
 */
export default async function setup(project: TestProject) {
  // тестовое хранилище очищается вместе с тестовой БД
  rmSync(path.resolve(import.meta.dirname, "../.test-storage"), { recursive: true, force: true });
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://app:app@localhost:5432/construction_registry_test?schema=public";
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Тестовая БД должна оканчиваться на _test, получено: ${dbName}`);
  try {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    const prisma = new PrismaClient({ datasourceUrl: url });
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
    await prisma.$disconnect();
    project.provide("integrationDb", true);
  } catch (e) {
    console.warn("Тестовая БД недоступна — интеграционные тесты будут пропущены:", e instanceof Error ? e.message.split("\n")[0] : e);
    project.provide("integrationDb", false);
  }
}
