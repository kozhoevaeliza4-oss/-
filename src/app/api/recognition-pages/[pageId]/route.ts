import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { getCurrentUser, getProjectAccess } from "@/lib/server/auth";
import { readDocument } from "@/lib/server/storage";

/**
 * Изображение страницы распознаваемого документа (только участникам проекта с правом просмотра АВР).
 * processed — подготовленное для OCR изображение (координаты подсветки относятся к нему); original — исходный файл.
 */
export async function GET(req: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const page = await prisma.actRecognitionPage.findUnique({ where: { id: pageId }, include: { recognition: true, document: true } });
  if (!page) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const access = await getProjectAccess(page.recognition.projectId);
  if (!access?.can("project.view") || !access.can("act.view")) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const variant = new URL(req.url).searchParams.get("v") ?? "processed";
  try {
    if (variant === "processed" && page.processedPath) {
      return new NextResponse(new Uint8Array(await readDocument(page.processedPath)), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
    }
    // Оригинал отдаём как изображение только для браузерных форматов; HEIC/PDF — через скачивание документа
    if (!/^image\/(jpeg|png)$/.test(page.document.mimeType)) return NextResponse.json({ error: "Предпросмотр недоступен" }, { status: 415 });
    return new NextResponse(new Uint8Array(await readDocument(page.document.storagePath)), { headers: { "Content-Type": page.document.mimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Файл недоступен" }, { status: 410 });
  }
}
