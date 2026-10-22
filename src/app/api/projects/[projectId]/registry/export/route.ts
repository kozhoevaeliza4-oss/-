import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { contentDisposition } from "@/lib/server/http";
import { getCurrentUser, getProjectAccess } from "@/lib/server/auth";
import { loadRegistry } from "@/lib/server/registry";
import { applyRegistryFilters, filtersFromParams, filtersToQuery } from "@/lib/registryFilter";
import { REGISTRY_COLUMNS } from "@/lib/registryColumns";
import { logAudit } from "@/lib/server/audit";

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const access = await getProjectAccess(projectId);
  if (!access || !access.can("project.view")) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (!access.can("report.export")) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const url = new URL(req.url);
  const filters = filtersFromParams(url.searchParams);
  const data = await loadRegistry(projectId);
  const rows = applyRegistryFilters(data.rows, filters);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Реестр строительных работ";
  wb.created = new Date();
  const ws = wb.addWorksheet("Реестр работ", { views: [{ state: "frozen", ySplit: 6 }] });
  ws.addRow([`Реестр работ: ${data.project.code} — ${data.project.name}`]).font = { bold: true, size: 13 };
  ws.addRow([
    `Сформирован: ${new Date().toLocaleString("ru-RU")} · пользователь: ${user.name} · валюта: ${data.project.currency} · смета: ${
      data.currentVersion ? `v${data.currentVersion.versionNumber} «${data.currentVersion.name}»` : "не утверждена"
    }`,
  ]);
  ws.addRow([`Фильтры: ${filtersToQuery(filters) || "нет"} · строк: ${rows.length} из ${data.rows.length}`]);
  ws.addRow([
    data.project.isDemo
      ? "ВНИМАНИЕ: демонстрационный проект, данные тестовые."
      : data.project.costMethodologyConfirmed
        ? "Методика учёта затрат 1С согласована."
        : "Методика учёта затрат 1С не согласована: суммы 1С — импортированные затраты, отклонения предварительные.",
  ]).font = { italic: true, color: { argb: "FF9A3412" } };
  ws.addRow(["Пустая ячейка означает отсутствие данных (не ноль)."]).font = { italic: true };
  const header = ws.addRow(REGISTRY_COLUMNS.map((c) => c.label));
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: "middle" };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cell.border = { bottom: { style: "thin" } };
  });

  for (const r of rows) {
    ws.addRow(
      REGISTRY_COLUMNS.map((c) => {
        const v = c.value(r);
        if (v === null) return null;
        if (c.kind === "money" || c.kind === "qty" || c.kind === "pct") return Number(v);
        if (c.kind === "date") return new Date(v + "T00:00:00Z");
        return v;
      }),
    );
  }
  REGISTRY_COLUMNS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? 14;
    if (c.kind === "money") col.numFmt = "#,##0.00";
    if (c.kind === "qty") col.numFmt = "#,##0.####";
    if (c.kind === "pct") col.numFmt = "0.0";
    if (c.kind === "date") col.numFmt = "dd.mm.yyyy";
  });
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: REGISTRY_COLUMNS.length } };

  const buf = await wb.xlsx.writeBuffer();
  await logAudit({ userId: user.id, projectId, action: "registry.export", entityType: "Project", entityId: projectId, after: { rows: rows.length, filters } });
  const fileName = `registry_${data.project.code}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(fileName),
      "Cache-Control": "no-store",
    },
  });
}
