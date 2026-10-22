/** Сборка строк текста из слов OCR с сохранением координат. */
import type { OcrWord } from "./ocrTypes";

export interface OcrLine {
  words: OcrWord[];
  text: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Минимальная уверенность слов строки */
  minConf: number;
}

export function wordsToLines(words: OcrWord[]): OcrLine[] {
  const groups = new Map<string, OcrWord[]>();
  for (const w of words) {
    const k = `${w.block}:${w.par}:${w.line}`;
    const g = groups.get(k);
    if (g) g.push(w);
    else groups.set(k, [w]);
  }
  const lines = [...groups.values()].map((ws) => {
    ws.sort((a, b) => a.left - b.left);
    return {
      words: ws,
      text: joinWords(ws),
      top: Math.min(...ws.map((w) => w.top)),
      bottom: Math.max(...ws.map((w) => w.top + w.height)),
      left: Math.min(...ws.map((w) => w.left)),
      right: Math.max(...ws.map((w) => w.left + w.width)),
      minConf: Math.min(...ws.map((w) => (w.conf < 0 ? 100 : w.conf))),
    };
  });
  return mergeSameRow(lines.sort((a, b) => a.top - b.top || a.left - b.left));
}

/** Слова, разделённые большим промежутком, соединяются табуляцией (граница колонок). */
export function joinWords(ws: OcrWord[]): string {
  if (!ws.length) return "";
  const avgChar = ws.reduce((s, w) => s + w.width / Math.max(1, w.text.length), 0) / ws.length;
  let out = ws[0].text;
  for (let i = 1; i < ws.length; i++) {
    const gap = ws[i].left - (ws[i - 1].left + ws[i - 1].width);
    out += gap > avgChar * 2.5 ? "\t" : " ";
    out += ws[i].text;
  }
  return out;
}

/** Tesseract иногда делит одну строку таблицы на несколько «строк» — объединяем по вертикальному перекрытию. */
function mergeSameRow(lines: OcrLine[]): OcrLine[] {
  const out: OcrLine[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev) {
      const overlap = Math.min(prev.bottom, l.bottom) - Math.max(prev.top, l.top);
      const minH = Math.min(prev.bottom - prev.top, l.bottom - l.top);
      const horizontallyDisjoint = l.left > prev.right || l.right < prev.left;
      if (overlap > minH * 0.6 && horizontallyDisjoint) {
        const words = [...prev.words, ...l.words].sort((a, b) => a.left - b.left);
        out[out.length - 1] = {
          words,
          text: joinWords(words),
          top: Math.min(prev.top, l.top),
          bottom: Math.max(prev.bottom, l.bottom),
          left: Math.min(prev.left, l.left),
          right: Math.max(prev.right, l.right),
          minConf: Math.min(prev.minConf, l.minConf),
        };
        continue;
      }
    }
    out.push(l);
  }
  return out;
}
