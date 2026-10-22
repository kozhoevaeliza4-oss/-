/**
 * Регрессия QA: каждое действие, записываемое в журнал, имеет человекочитаемую подпись
 * (иначе пользователь видит технический код вроде «act.create»).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACTION_LABELS } from "@/lib/auditLabels";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("Журнал действий", () => {
  it("все действия logAudit имеют подписи", () => {
    const actions = new Set<string>();
    for (const f of files(join(__dirname, "../src"))) {
      const src = readFileSync(f, "utf8");
      if (!src.includes("logAudit")) continue;
      for (const m of src.matchAll(/logAudit\(\{[^}]*?action:\s*([^,]+),/g)) {
        for (const lit of m[1].matchAll(/"([a-zA-Z]+\.[a-zA-Z.]+)"/g)) actions.add(lit[1]);
        if (m[1].includes("allocation.${")) for (const s of ["proposed", "confirmed", "rejected"]) actions.add(`allocation.${s}`);
      }
      // многострочные вызовы
      for (const m of src.matchAll(/^\s*action:\s*(.+?),?\s*$/gm)) for (const lit of m[1].matchAll(/"([a-zA-Z]+\.[a-zA-Z.]+)"/g)) actions.add(lit[1]);
    }
    expect(actions.size).toBeGreaterThan(40);
    const missing = [...actions].filter((a) => !ACTION_LABELS[a]);
    expect(missing).toEqual([]);
  });
});
