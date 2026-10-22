import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentKind } from "@prisma/client";
import { prisma } from "./db";
import { UserError } from "./action";

/** Корень приватного хранилища (вне public/). Файлы отдаются только через маршрут с проверкой прав. */
export function storageRoot() {
  return path.resolve(process.env.STORAGE_DIR || "./storage");
}

export function maxUploadBytes() {
  const mb = Number(process.env.MAX_UPLOAD_MB || 25);
  return (Number.isFinite(mb) && mb > 0 ? mb : 25) * 1024 * 1024;
}

const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  csv: "text/csv",
  txt: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  heic: "image/heic",
  heif: "image/heif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** Проверка сигнатуры файла: расширение должно соответствовать содержимому. */
function signatureOk(ext: string, buf: Buffer): boolean {
  const zip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  switch (ext) {
    case "xlsx":
    case "xlsm":
    case "docx":
      return zip;
    case "pdf":
      return buf.subarray(0, 5).toString("latin1") === "%PDF-";
    case "png":
      return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "jpg":
    case "jpeg":
      return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "heic":
    case "heif":
      // ISO BMFF: «ftyp» по смещению 4 и бренд heic/heix/mif1/msf1
      return buf.length > 12 && buf.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(buf.subarray(8, 12).toString("latin1"));
    case "csv":
    case "txt":
      // текст: без нулевых байтов в начале (кроме UTF-16 BOM)
      return (buf[0] === 0xff && buf[1] === 0xfe) || !buf.subarray(0, 4096).includes(0);
    default:
      return false;
  }
}

export interface SavedDocument {
  id: string;
  sha256: string;
  originalName: string;
  buffer: Buffer;
}

export async function saveUpload(opts: {
  file: File | null;
  projectId: string;
  kind: DocumentKind;
  userId: string;
  allowed: string[];
}): Promise<SavedDocument> {
  const { file } = opts;
  if (!file || typeof file === "string" || (file.size === 0 && !file.name)) throw new UserError("Выберите файл");
  if (file.size === 0) throw new UserError(`Файл «${file.name}» пуст (0 байт) — выберите другой файл`);
  if (file.size > maxUploadBytes()) throw new UserError(`Файл больше ${Math.round(maxUploadBytes() / 1024 / 1024)} МБ`);
  const originalName = path.basename(file.name).slice(0, 255);
  const ext = originalName.toLowerCase().split(".").pop() ?? "";
  if (!opts.allowed.includes(ext)) throw new UserError(`Недопустимый тип файла. Разрешено: ${opts.allowed.join(", ")}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!signatureOk(ext, buffer)) throw new UserError("Содержимое файла не соответствует его расширению");

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const rel = path.join(opts.projectId, `${randomUUID()}.${ext}`);
  const abs = path.join(storageRoot(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buffer, { mode: 0o600 });

  const doc = await prisma.document.create({
    data: {
      projectId: opts.projectId,
      kind: opts.kind,
      originalName,
      storagePath: rel,
      mimeType: MIME[ext] ?? "application/octet-stream",
      size: buffer.length,
      sha256,
      uploadedById: opts.userId,
    },
  });
  return { id: doc.id, sha256, originalName, buffer };
}

export async function readDocument(storagePath: string): Promise<Buffer> {
  const root = storageRoot();
  const abs = path.resolve(root, storagePath);
  if (!abs.startsWith(root + path.sep)) throw new Error("Недопустимый путь к файлу");
  return readFile(abs);
}
