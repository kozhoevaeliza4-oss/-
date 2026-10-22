import { NextResponse } from "next/server";
import { contentDisposition } from "@/lib/server/http";
import { prisma } from "@/lib/server/db";
import { getCurrentUser, getProjectAccess } from "@/lib/server/auth";
import { readDocument } from "@/lib/server/storage";
import { logAudit } from "@/lib/server/audit";

/** Скачивание документа: только авторизованным участникам проекта с правом document.download. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc || !doc.projectId) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const access = await getProjectAccess(doc.projectId);
  if (!access || !access.can("project.view")) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (!access.can("document.download")) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  let buf: Buffer;
  try {
    buf = await readDocument(doc.storagePath);
  } catch {
    return NextResponse.json({ error: "Файл недоступен в хранилище" }, { status: 410 });
  }
  await logAudit({ userId: user.id, projectId: doc.projectId, action: "document.download", entityType: "Document", entityId: doc.id, after: { name: doc.originalName } });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": contentDisposition(doc.originalName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
