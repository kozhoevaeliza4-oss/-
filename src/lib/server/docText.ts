import "server-only";
import JSZip from "jszip";
import { pdfText, pdfToImages } from "./ocr/tools";
import { prepareImage, tesseractEngine } from "./ocr/engine";
import { parseTabular } from "@/lib/import/tabular";
import { wordsToLines } from "@/lib/extract/layout";

export interface TextPage {
  /** Номер страницы / листа / раздела, начиная с 1 */
  page: number;
  label: string;
  text: string;
  method: "pdf-text" | "docx" | "xlsx" | "ocr";
  confidence?: number | null;
}

export interface DocumentTextResult {
  pages: TextPage[];
  warnings: string[];
}

/**
 * Извлечение текста документа с сохранением страниц (для указания источника каждого поля).
 * PDF с текстовым слоем — pdftotext; скан — OCR; DOCX — текст абзацев; XLSX — строки листов.
 */
export async function extractDocumentText(buffer: Buffer, fileName: string): Promise<DocumentTextResult> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const warnings: string[] = [];
  if (ext === "pdf") {
    let pages: string[] = [];
    try {
      pages = await pdfText(buffer);
    } catch (e) {
      warnings.push(`Текстовый слой PDF не прочитан: ${e instanceof Error ? e.message : e}`);
    }
    const textChars = pages.join("").replace(/\s/g, "").length;
    if (pages.length && textChars / pages.length > 80) {
      return { pages: pages.map((t, i) => ({ page: i + 1, label: `стр. ${i + 1}`, text: t, method: "pdf-text" })), warnings };
    }
    warnings.push("В PDF нет текстового слоя — выполнено распознавание (OCR)");
    const images = await pdfToImages(buffer, 300, 30);
    return { pages: await ocrPages(images, warnings), warnings };
  }
  if (ext === "docx") {
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("DOCX повреждён: нет word/document.xml");
    const paragraphs = xml
      .split(/<\/w:p>/)
      .map((p) =>
        p
          .replace(/<w:tab\/>/g, "\t")
          .replace(/<w:br\/>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&")
          .trim(),
      )
      .filter(Boolean);
    return { pages: [{ page: 1, label: "документ", text: paragraphs.join("\n"), method: "docx" }], warnings };
  }
  if (ext === "xlsx" || ext === "xlsm" || ext === "csv") {
    const sheets = await parseTabular(buffer, fileName);
    return {
      pages: sheets.map((s, i) => ({
        page: i + 1,
        label: `лист «${s.name}»`,
        text: s.rows.map((r) => r.filter((c) => c !== null).join("\t")).join("\n"),
        method: "xlsx",
      })),
      warnings,
    };
  }
  if (["jpg", "jpeg", "png", "heic", "heif", "webp", "tif", "tiff"].includes(ext)) {
    const prepared = await prepareImage(buffer, fileName);
    return { pages: await ocrPages([prepared.png], warnings, true), warnings };
  }
  throw new Error(`Формат «.${ext}» не поддерживается для извлечения текста`);
}

async function ocrPages(images: Buffer[], warnings: string[], prepared = false): Promise<TextPage[]> {
  const av = await tesseractEngine.available();
  if (!av.ok) {
    warnings.push(`${av.reason}. Заполните данные вручную.`);
    return [];
  }
  const out: TextPage[] = [];
  for (const [i, img] of images.entries()) {
    const png = prepared ? img : (await prepareImage(img, "page.png")).png;
    const page = await tesseractEngine.recognize(png);
    const lines = wordsToLines(page.words);
    out.push({ page: i + 1, label: `стр. ${i + 1}`, text: lines.map((l) => l.text).join("\n"), method: "ocr", confidence: page.meanConfidence });
  }
  return out;
}
