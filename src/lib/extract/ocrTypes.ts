/** Результат OCR одной страницы: слова с координатами (px) и уверенностью 0–100. */
export interface OcrWord {
  text: string;
  conf: number;
  left: number;
  top: number;
  width: number;
  height: number;
  block: number;
  par: number;
  line: number;
}

export interface OcrPage {
  width: number;
  height: number;
  words: OcrWord[];
  meanConfidence: number | null;
}

/** Прямоугольник на странице в долях (0–1) — для подсветки на оригинале. */
export interface BBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
