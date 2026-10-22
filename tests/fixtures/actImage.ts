/**
 * Генератор тестовых изображений АВР (вымышленные данные) для проверки конвейера распознавания.
 * Рисует страницу формы, похожей на КС-2, и при необходимости имитирует фотографию:
 * тёмный фон вокруг листа, наклон, неравномерная яркость.
 */
import sharp from "sharp";

export interface FixtureLine {
  no: string;
  code: string;
  name: string;
  unit: string;
  qty: string;
  price: string;
  amount: string;
}

export interface FixtureAct {
  number: string;
  date: string;
  periodFrom: string;
  periodTo: string;
  customer: string;
  contractor: string;
  inn: string;
  contract: string;
  object: string;
  lines: FixtureLine[];
  subtotal: string;
  vat?: string;
  total: string;
  words?: string;
  /** Продолжение таблицы на следующей странице: индексы строк для этой страницы */
  pageLines?: [number, number];
  showHeader?: boolean;
  showTotals?: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function actSvg(a: FixtureAct, W = 2480, H = 3508): string {
  const font = `font-family="DejaVu Sans" fill="#111"`;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  const text = (x: number, y: number, s: string, size = 40, anchor = "start", weight = "normal") =>
    parts.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" ${font}>${esc(s)}</text>`);
  let y = 160;
  if (a.showHeader !== false) {
    text(W - 160, y, "Унифицированная форма № КС-2", 34, "end");
    y += 110;
    text(160, y, `Заказчик: ${a.customer}`);
    y += 70;
    text(160, y, `Подрядчик: ${a.contractor} ИНН ${a.inn}`);
    y += 70;
    text(160, y, `Стройка: ${a.object}`);
    y += 70;
    text(160, y, `Договор подряда № ${a.contract}`);
    y += 130;
    text(W / 2, y, `АКТ № ${a.number} от ${a.date}`, 56, "middle", "bold");
    y += 70;
    text(W / 2, y, "о приемке выполненных работ", 44, "middle");
    y += 80;
    text(W / 2, y, `Отчетный период с ${a.periodFrom} по ${a.periodTo}`, 40, "middle");
    y += 110;
  } else {
    text(160, y, `Продолжение акта № ${a.number}`, 36);
    y += 100;
  }
  // Таблица
  const cols = [100, 200, 470, 1250, 1390, 1600, 1900, 2380];
  const headers = ["№", "Шифр", "Наименование работ", "Ед.", "Кол-во", "Цена", "Сумма"];
  const rowH = 90;
  const tableTop = y;
  const hline = (yy: number) => parts.push(`<line x1="${cols[0]}" y1="${yy}" x2="${cols[cols.length - 1]}" y2="${yy}" stroke="#222" stroke-width="3"/>`);
  hline(y);
  headers.forEach((h, i) => text(i === 2 ? cols[i] + 20 : (cols[i] + cols[i + 1]) / 2, y + 60, h, 38, i === 2 ? "start" : "middle", "bold"));
  y += rowH;
  hline(y);
  headers.forEach((_, i) => text((cols[i] + cols[i + 1]) / 2, y + 50, String(i + 1), 32, "middle"));
  y += 70;
  hline(y);
  const [from, to] = a.pageLines ?? [0, a.lines.length];
  for (const l of a.lines.slice(from, to)) {
    const cells = [l.no, l.code, l.name, l.unit, l.qty, l.price, l.amount];
    cells.forEach((c, i) => {
      if (i === 2) text(cols[i] + 20, y + 60, c, 38);
      else if (i >= 4) text(cols[i + 1] - 20, y + 60, c, 38, "end");
      else text((cols[i] + cols[i + 1]) / 2, y + 60, c, 36, "middle");
    });
    y += rowH;
    hline(y);
  }
  cols.forEach((x) => parts.push(`<line x1="${x}" y1="${tableTop}" x2="${x}" y2="${y}" stroke="#222" stroke-width="3"/>`));
  if (a.showTotals !== false) {
    y += 90;
    text(cols[2] + 20, y, "Итого", 40, "start", "bold");
    text(cols[7] - 20, y, a.subtotal, 40, "end", "bold");
    if (a.vat) {
      y += 75;
      text(cols[2] + 20, y, "НДС 12%", 40);
      text(cols[7] - 20, y, a.vat, 40, "end");
    }
    y += 75;
    text(cols[2] + 20, y, "Всего по акту", 40, "start", "bold");
    text(cols[7] - 20, y, a.total, 40, "end", "bold");
    if (a.words) {
      y += 110;
      text(160, y, `Сумма прописью: ${a.words}`, 36);
    }
    y += 160;
    text(160, y, "Сдал: Прораб ____________ Иванов И.И.", 38);
    y += 90;
    text(160, y, "Принял: Технадзор ____________ Петров П.П.", 38);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`;
}

/** Чистый «скан» страницы. */
export async function actScan(a: FixtureAct): Promise<Buffer> {
  return sharp(Buffer.from(actSvg(a))).png().toBuffer();
}

/** «Фотография»: лист уменьшен, повёрнут на угол, лежит на тёмном фоне, слегка размыт. */
export async function actPhoto(a: FixtureAct, angle = 2.5): Promise<Buffer> {
  const page = await sharp(Buffer.from(actSvg(a))).resize({ width: 1900 }).png().toBuffer();
  const rotated = await sharp(page).rotate(angle, { background: "#3a3a3a" }).toBuffer();
  const meta = await sharp(rotated).metadata();
  const bg = await sharp({ create: { width: meta.width! + 300, height: meta.height! + 300, channels: 3, background: "#3a3a3a" } })
    .composite([{ input: rotated, left: 150, top: 150 }])
    .modulate({ brightness: 0.92 })
    .blur(0.6)
    .jpeg({ quality: 85 })
    .toBuffer();
  return bg;
}

export const SAMPLE_ACT: FixtureAct = {
  number: "АВР-15",
  date: "20.10.2026",
  periodFrom: "01.10.2026",
  periodTo: "20.10.2026",
  customer: "ОсОО Тест-Заказчик",
  contractor: "ОсОО Тест-Монолит",
  inn: "01234567891011",
  contract: "Д-02/26 от 10.03.2026",
  object: "Жилой комплекс Пример, корпус 1",
  lines: [
    { no: "1", code: "06-01-015", name: "Монолитные колонны и стены", unit: "м3", qty: "120", price: "12 500,00", amount: "1 500 000,00" },
    { no: "2", code: "06-01-034", name: "Монолитные перекрытия", unit: "м3", qty: "85,5", price: "11 800,00", amount: "1 008 900,00" },
    { no: "3", code: "08-01-003", name: "Гидроизоляция фундаментов", unit: "м2", qty: "300", price: "650,00", amount: "195 000,00" },
    { no: "4", code: "99-00-001", name: "Вывоз строительного мусора", unit: "т", qty: "12", price: "1 500,00", amount: "18 500,00" },
  ],
  subtotal: "2 722 400,00",
  vat: "326 688,00",
  total: "3 049 088,00",
  words: "Три миллиона сорок девять тысяч восемьдесят восемь сом 00 тыйын",
};
