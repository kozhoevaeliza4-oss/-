// Генерирует PNG-иконки приложения без сторонних зависимостей:
// синий фон и белая галочка. Запуск: npm run icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BLUE = [47, 107, 255];
const OUT = path.join(__dirname, '..', 'public', 'icons');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Галочка в единичных координатах; scale < 1 — отступ для maskable-иконок.
function inCheck(u, v, scale) {
  const c = (p) => 0.5 + (p - 0.5) * scale;
  const pts = [[0.27, 0.52], [0.43, 0.68], [0.74, 0.35]].map(([x, y]) => [c(x), c(y)]);
  const d = Math.min(
    distToSegment(u, v, ...pts[0], ...pts[1]),
    distToSegment(u, v, ...pts[1], ...pts[2]),
  );
  return d < 0.055 * scale;
}

function inRoundRect(u, v, r) {
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  return Math.hypot(u - cx, v - cy) <= r;
}

// Сглаживание: 4×4 подвыборки на пиксель.
function render(size, { rounded, scale, background = true }) {
  const S = 4;
  return png(size, (x, y) => {
    let bg = 0, fg = 0;
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const u = (x + (i + 0.5) / S) / size;
        const v = (y + (j + 0.5) / S) / size;
        const inBg = background && (!rounded || inRoundRect(u, v, 0.22));
        const inFg = inCheck(u, v, scale);
        if (inFg) fg++;
        else if (inBg) bg++;
      }
    }
    const n = S * S;
    const alpha = (bg + fg) / n;
    if (!alpha) return [0, 0, 0, 0];
    const f = fg / (bg + fg);
    const mix = (k) => Math.round(BLUE[k] * (1 - f) + 255 * f);
    return [mix(0), mix(1), mix(2), Math.round(alpha * 255)];
  });
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': render(192, { rounded: true, scale: 1 }),
  'icon-512.png': render(512, { rounded: true, scale: 1 }),
  'icon-maskable-512.png': render(512, { rounded: false, scale: 0.75 }),
  'apple-touch-icon.png': render(180, { rounded: false, scale: 0.9 }),
  'badge-96.png': render(96, { rounded: false, scale: 1.2, background: false }),
};
for (const [name, buf] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`${name}: ${buf.length} байт`);
}
