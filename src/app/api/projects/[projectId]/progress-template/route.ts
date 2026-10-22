import { NextResponse } from "next/server";
import { contentDisposition } from "@/lib/server/http";
import { getCurrentUser, getProjectAccess } from "@/lib/server/auth";
import { buildProgressTemplate } from "@/lib/server/services/progressImport";
import { logAudit } from "@/lib/server/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const access = await getProjectAccess(projectId);
  if (!access || !access.can("project.view")) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (!access.can("progress.update")) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const buf = await buildProgressTemplate(projectId);
  await logAudit({ userId: user.id, projectId, action: "progress.templateExport", entityType: "Project", entityId: projectId });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(`progress_template_${new Date().toISOString().slice(0, 10)}.xlsx`),
      "Cache-Control": "no-store",
    },
  });
}
