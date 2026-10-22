import "server-only";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { exclusive, heicToJpeg, ocrLanguageString, run, toolAvailable, withTempDir } from "./tools";
import type { OcrPage, OcrWord } from "@/lib/extract/ocrTypes";

/**
 * Локальный OCR-адаптер (Tesseract). Изолирован за интерфейсом OcrEngine —
 * провайдер можно заменить, не меняя разбор документов. Внешние сервисы не используются.
 */
export interface OcrEngine {
  name: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  recognize(image: Buffer): Promise<OcrPage>;
}

const TESSERACT = () => process.env.TESSERACT_PATH || "tesseract";

export const tesseractEngine: OcrEngine = {
  name: "tesseract",
  async available() {
    if (!(await toolAvailable(TESSERACT()))) return { ok: false, reason: "Tesseract OCR не установлен на сервере" };
    if (!(await ocrLanguageString())) return { ok: false, reason: "Не установлены языковые данные Tesseract (rus/kir/eng)" };
    return { ok: true };
  },
  async recognize(image: Buffer): Promise<OcrPage> {
    const langs = (await ocrLanguageString()) ?? "eng";
    const psm = process.env.OCR_PSM || "6";
    return withTempDir(async (dir) => {
      const file = path.join(dir, "page.png");
      await writeFile(file, image);
      const meta = await sharp(image).metadata();
      const { stdout } = await exclusive(() =>
        run(TESSERACT(), [file, "stdout", "-l", langs, "--psm", psm, "-c", "preserve_interword_spaces=1", "tsv"], { timeoutMs: 240_000 }),
      );
      const words = parseTsv(stdout.toString("utf8"));
      const confs = words.filter((w) => w.conf >= 0).map((w) => w.conf);
      return {
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        words,
        meanConfidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
      };
    });
  },
};

export function parseTsv(tsv: string): OcrWord[] {
  const out: OcrWord[] = [];
  const lines = tsv.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    if (c.length < 12 || c[0] !== "5") continue; // level 5 = слово
    const text = c.slice(11).join("\t").trim();
    if (!text) continue;
    out.push({
      text,
      conf: Number(c[10]),
      left: Number(c[6]),
      top: Number(c[7]),
      width: Number(c[8]),
      height: Number(c[9]),
      block: Number(c[2]),
      par: Number(c[3]),
      line: Number(c[4]),
    });
  }
  return out;
}

// ───────────── Предобработка изображения ─────────────

export interface PreparedImage {
  png: Buffer;
  width: number;
  height: number;
  rotation: number;
  deskewAngle: number;
  cropped: boolean;
  notes: string[];
}

/**
 * Подготовка фотографии для OCR. Оригинал не изменяется — создаётся отдельное изображение:
 * поворот по EXIF и по ориентации текста, обрезка по границам листа, выравнивание наклона,
 * оттенки серого, нормализация контраста, масштабирование.
 * Перспективная коррекция (трапеция) не выполняется — фотографируйте лист сверху.
 */
export async function prepareImage(input: Buffer, fileName: string): Promise<PreparedImage> {
  const notes: string[] = [];
  let buf = input;
  if (/\.(heic|heif)$/i.test(fileName)) {
    if (!(await toolAvailable("heif-convert", "--version"))) throw new Error("Формат HEIC не поддерживается на сервере. Сохраните фото как JPEG.");
    buf = await heicToJpeg(buf);
  }
  // EXIF-ориентация и ограничение размера
  let img = sharp(buf, { limitInputPixels: 120_000_000 }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("Не удалось прочитать изображение");
  let gray: Buffer = await img.grayscale().normalize().png().toBuffer();

  // Границы листа: светлая область на более тёмном фоне
  const crop = await detectPage(gray);
  let cropped = false;
  if (crop) {
    gray = await sharp(gray).extract(crop).png().toBuffer();
    cropped = true;
    notes.push("Изображение обрезано по границам листа");
  }

  // Ориентация текста (0/90/180/270) по Tesseract OSD
  let rotation = 0;
  try {
    rotation = await detectOrientation(gray);
    if (rotation) {
      gray = await sharp(gray).rotate(rotation, { background: "#ffffff" }).png().toBuffer();
      notes.push(`Повёрнуто на ${rotation}°`);
    }
  } catch {
    // OSD недоступен или мало текста — оставляем как есть
  }

  // Выравнивание небольшого наклона
  const angle = await estimateSkew(gray);
  if (Math.abs(angle) >= 0.3) {
    gray = await sharp(gray).rotate(angle, { background: "#ffffff" }).png().toBuffer();
    notes.push(`Выровнен наклон ${angle.toFixed(1)}°`);
  }

  // Линии таблицы мешают OCR (склеивают соседние ячейки) — удаляем длинные горизонтальные и вертикальные линии
  const lines = await removeRuledLines(gray);
  if (lines.removed) {
    gray = lines.png;
    notes.push("Удалены линии таблицы");
  }

  // Масштаб: Tesseract лучше работает при высоте строчных букв ~20–30 px
  const m2 = await sharp(gray).metadata();
  let w = m2.width ?? 0;
  const target = w < 1800 ? 2200 : w > 3600 ? 3400 : w;
  img = sharp(gray);
  if (target !== w) {
    img = img.resize({ width: target });
    w = target;
  }
  const png = await img.sharpen().png().toBuffer();
  const fin = await sharp(png).metadata();
  return { png, width: fin.width ?? w, height: fin.height ?? 0, rotation, deskewAngle: Math.abs(angle) >= 0.3 ? angle : 0, cropped, notes };
}

async function detectOrientation(png: Buffer): Promise<number> {
  return withTempDir(async (dir) => {
    const f = path.join(dir, "osd.png");
    await writeFile(f, png);
    const { stdout } = await exclusive(() => run(TESSERACT(), [f, "stdout", "--psm", "0", "-l", "osd"], { timeoutMs: 60_000 }));
    const text = stdout.toString();
    const rot = Number(/Rotate:\s*(\d+)/.exec(text)?.[1] ?? 0);
    const conf = Number(/Orientation confidence:\s*([\d.]+)/.exec(text)?.[1] ?? 0);
    return conf >= 2 ? rot : 0;
  });
}

/** Поиск листа: строки/столбцы, где доля светлых пикселей > 50 %. null — если обрезка не нужна или ненадёжна. */
async function detectPage(gray: Buffer): Promise<{ left: number; top: number; width: number; height: number } | null> {
  const meta = await sharp(gray).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const scale = 400 / W;
  const { data: rawData, info } = await sharp(gray).resize({ width: 400 }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  // изображение может быть многоканальным — берём первый канал
  const data = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) data[i] = rawData[i * info.channels];
  const thr = otsu(data);
  const rowFrac = new Array(h).fill(0);
  const colFrac = new Array(w).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[y * w + x] > thr) {
        rowFrac[y]++;
        colFrac[x]++;
      }
  const rows = rowFrac.map((v) => v / w);
  const cols = colFrac.map((v) => v / h);
  const first = (a: number[]) => a.findIndex((v) => v > 0.5);
  const last = (a: number[]) => a.length - 1 - [...a].reverse().findIndex((v) => v > 0.5);
  const y0 = first(rows);
  const y1 = last(rows);
  const x0 = first(cols);
  const x1 = last(cols);
  if (y0 < 0 || x0 < 0) return null;
  const area = ((x1 - x0) * (y1 - y0)) / (w * h);
  // Обрезаем, только если фон заметен, а лист занимает разумную часть кадра
  if (area > 0.92 || area < 0.25) return null;
  const pad = 4;
  const left = Math.max(0, Math.floor((x0 - pad) / scale));
  const top = Math.max(0, Math.floor((y0 - pad) / scale));
  const right = Math.min(W, Math.ceil((x1 + pad) / scale));
  const bottom = Math.min(H, Math.ceil((y1 + pad) / scale));
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Удаление линий разлиновки: в бинаризованном изображении ищутся непрерывные тёмные отрезки,
 * длина которых много больше высоты символов, и закрашиваются белым. Текст не затрагивается.
 */
export async function removeRuledLines(gray: Buffer): Promise<{ png: Buffer; removed: boolean }> {
  const { data, info } = await sharp(gray).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const ch = info.channels;
  const px = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) px[i] = data[i * ch];
  const thr = Math.min(otsu(Buffer.from(px)), 170);
  const mark = new Uint8Array(W * H);
  const minH = Math.max(120, Math.floor(W * 0.08));
  const minV = Math.max(100, Math.floor(H * 0.03));
  let count = 0;
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const dark = x < W && px[y * W + x] < thr;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        if (x - start >= minH) {
          for (let k = start; k < x; k++) mark[y * W + k] = 1;
          count++;
        }
        start = -1;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      const dark = y < H && px[y * W + x] < thr;
      if (dark && start < 0) start = y;
      if (!dark && start >= 0) {
        if (y - start >= minV) {
          for (let k = start; k < y; k++) mark[k * W + x] = 1;
          count++;
        }
        start = -1;
      }
    }
  }
  if (count === 0) return { png: gray, removed: false };
  // Захватываем соседние пиксели сглаживания линии
  const out = Buffer.from(px);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!mark[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < H && xx >= 0 && xx < W && px[yy * W + xx] < 235) out[yy * W + xx] = 255;
        }
    }
  return { png: await sharp(out, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer(), removed: true };
}

function otsu(data: Buffer): number {
  const hist = new Array(256).fill(0);
  for (const v of data) hist[v]++;
  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = i;
    }
  }
  return thr;
}

/** Оценка наклона текста методом проекционного профиля (±5°). */
async function estimateSkew(gray: Buffer): Promise<number> {
  const small = await sharp(gray).resize({ width: 700 }).png().toBuffer();
  let bestAngle = 0;
  let bestScore = -1;
  for (let a = -5; a <= 5.001; a += 0.5) {
    const { data, info } = await sharp(small).rotate(a, { background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
    const thr = 140;
    let score = 0;
    let prev = 0;
    for (let y = 0; y < info.height; y++) {
      let dark = 0;
      for (let x = 0; x < info.width; x++) if (data[y * info.width * info.channels + x * info.channels] < thr) dark++;
      score += (dark - prev) ** 2;
      prev = dark;
    }
    if (score > bestScore) {
      bestScore = score;
      bestAngle = a;
    }
  }
  return bestAngle;
}
