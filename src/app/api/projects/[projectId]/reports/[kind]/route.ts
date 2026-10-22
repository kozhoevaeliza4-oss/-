import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { getCurrentUser, getProjectAccess } from "@/lib/server/auth";
import { buildReport, REPORT_FILTER_KEYS, REPORTS, ReportFilters } from "@/lib/server/reports";
import { reportToPdf, reportToXlsx } from "@/lib/server/reportExport";
import { contentDisposition } from "@/lib/server/http";
import { logAudit } from "@/lib/server/audit";

/** Экспорт отчёта в XLSX/PDF (право report.export; экспорт журналируется). */
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string; kind: string }> }) {
  const { projectId, kind } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const access = await getProjectAccess(projectId);
  if (!access?.can("project.view")) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (!access.can("report.export")) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (!REPORTS[kind]) return NextResponse.json({ error: "Неизвестный отчёт" }, { status: 404 });
  if (kind === "audit" && !access.can("audit.view")) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if ((kind === "unclassified-1c" || kind === "contractors") && !access.can("accounting.view")) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const f: ReportFilters = {};
  for (const k of REPORT_FILTER_KEYS) {
    const v = sp.get(k);
    if (v) f[k] = v;
  }
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const report = await buildReport(projectId, kind, f);
  if (!report) return NextResponse.json({ error: "Неизвестный отчёт" }, { status: 404 });
  const meta = {
    projectName: project.name,
    projectCode: project.code,
    isDemo: project.isDemo,
    generatedAt: new Date(),
    userName: user.name,
    filters: Object.entries(f).map(([k, v]) => `${k}=${v}`).join(", "),
  };
  const buf = format === "pdf" ? await reportToPdf(report, meta) : await reportToXlsx(report, meta);
  await logAudit({ userId: user.id, projectId, action: "report.export", entityType: "Report", entityId: kind, after: { format, filters: f, rows: report.rows.length } });
  const name = `${kind}_${project.code}_${new Date().toISOString().slice(0, 10)}.${format}`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(name),
      "Cache-Control": "no-store",
    },
  });
}
