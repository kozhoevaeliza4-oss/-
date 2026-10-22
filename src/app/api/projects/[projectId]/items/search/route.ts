import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { getCurrentUser, getProjectAccess } from "@/lib/server/auth";

/** Поиск статей для выбора (распределение договоров, АВР, операций 1С). */
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const access = await getProjectAccess(projectId);
  if (!access?.can("project.view")) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
  const items = await prisma.workItem.findMany({
    where: {
      projectId,
      AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: "insensitive" as const } }, { code: { contains: w, mode: "insensitive" as const } }] })),
    },
    include: { object: { select: { code: true } }, section: { select: { code: true } } },
    orderBy: [{ code: "asc" }, { name: "asc" }],
    take: 25,
  });
  return NextResponse.json(
    items.map((i) => ({ id: i.id, label: `${i.code ? i.code + " — " : ""}${i.name}`, unit: i.unit, object: i.object?.code ?? null, section: i.section?.code ?? null })),
  );
}
