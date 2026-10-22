/**
 * Сквозная проверка конвейера распознавания на сгенерированных изображениях (без внешних сервисов).
 * Пропускается, если Tesseract не установлен.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { prepareImage, tesseractEngine } from "@/lib/server/ocr/engine";
import { parseActPages } from "@/lib/extract/act";
import { checkActArithmetic } from "@/lib/calc/actChecks";
import { actPhoto, actScan, SAMPLE_ACT } from "./fixtures/actImage";

const hasTesseract = (() => {
  try {
    execSync("tesseract --list-langs", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

async function recognize(img: Buffer, name: string) {
  const prepared = await prepareImage(img, name);
  const page = await tesseractEngine.recognize(prepared.png);
  return { prepared, page };
}

describe.runIf(hasTesseract)("OCR АВР (Tesseract)", () => {
  it("скан: реквизиты, строки и арифметика", async () => {
    const { page } = await recognize(await actScan(SAMPLE_ACT), "scan.png");
    const r = parseActPages([page]);
    if (process.env.OCR_DEBUG) console.log(r.fullText, JSON.stringify(r.lines.map((l) => Object.fromEntries(Object.entries(l.cells).map(([k, v]) => [k, v.value]))), null, 1));
    expect(r.fields.number.value).toBe("АВР-15");
    expect(r.fields.date.value).toBe("2026-10-20");
    expect(r.fields.periodFrom.value).toBe("2026-10-01");
    expect(r.fields.periodTo.value).toBe("2026-10-20");
    expect(r.fields.contractorInn.value).toBe("01234567891011");
    expect(r.fields.contractNumber.value).toBe("Д-02/26");
    expect(r.fields.total.value).toBe("3049088.00");
    expect(r.fields.vatAmount.value).toBe("326688.00");
    expect(r.lines).toHaveLength(4);
    expect(r.lines.map((l) => l.cells.amount.value)).toEqual(["1500000.00", "1008900.00", "195000.00", "18500.00"]);
    expect(r.lines[1].cells.quantity.value).toBe("85.5");
    expect(r.lines[0].cells.name.value).toMatch(/Монолитные колонны/);
    const checks = checkActArithmetic({
      lines: r.lines.map((l) => ({ quantity: l.cells.quantity.value, unitPrice: l.cells.unitPrice.value, amount: l.cells.amount.value })),
      subtotal: r.fields.subtotal.value,
      vatAmount: r.fields.vatAmount.value,
      total: r.fields.total.value,
      amountInWords: r.fields.amountInWords.value,
      hasCharges: r.hasCharges,
    });
    const codes = checks.map((c) => c.code);
    expect(codes).toContain("LINE_MISMATCH"); // строка 4: 12 × 1 500 ≠ 18 500
    expect(checks.find((c) => c.code === "LINE_MISMATCH")!.lineIndexes).toEqual([3]);
    expect(codes).toContain("SUBTOTAL_OK");
    expect(codes).toContain("VAT_TOTAL_OK");
  }, 120_000);

  it("многостраничный акт: строки не теряются на переходе таблицы", async () => {
    const p1 = await recognize(await actScan({ ...SAMPLE_ACT, pageLines: [0, 2], showTotals: false }), "p1.png");
    const p2 = await recognize(await actScan({ ...SAMPLE_ACT, pageLines: [2, 4], showHeader: false }), "p2.png");
    const r = parseActPages([p1.page, p2.page]);
    expect(r.lines.map((l) => l.cells.lineNo.value)).toEqual(["1", "2", "3", "4"]);
    expect(r.lines.map((l) => l.page)).toEqual([1, 1, 2, 2]);
    expect(r.fields.total.value).toBe("3049088.00");
    expect(r.lines[2].bbox!.page).toBe(2);
  }, 120_000);

  it("фото: обрезка по листу, выравнивание наклона, распознавание итога", async () => {
    const { prepared, page } = await recognize(await actPhoto(SAMPLE_ACT, 2.5), "photo.jpg");
    expect(prepared.cropped).toBe(true);
    expect(Math.abs(prepared.deskewAngle)).toBeGreaterThan(1);
    const r = parseActPages([page]);
    if (process.env.OCR_DEBUG) console.log(prepared.notes, r.fullText);
    expect(r.fields.number.value).toBe("АВР-15");
    expect(r.fields.total.value).toBe("3049088.00");
    expect(r.fields.contractorInn.value).toBe("01234567891011");
    expect(r.fields.customerName.value).toMatch(/Тест-Заказчик/);
    expect(r.lines.length).toBe(4);
    expect(r.lines[1].cells.name.value).toBe("Монолитные перекрытия");
  }, 120_000);
});
