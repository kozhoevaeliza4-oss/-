import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/globalSetup.ts"],
    // интеграционные тесты используют одну тестовую БД — выполняем файлы последовательно
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://app:app@localhost:5432/construction_registry_test?schema=public",
      STORAGE_DIR: path.resolve(import.meta.dirname, "storage/test"),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // в тестах серверные модули импортируются напрямую
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts"),
    },
  },
});
