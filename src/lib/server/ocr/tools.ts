import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Обёртки над локальными утилитами (Tesseract, poppler, libheif).
 * Документы обрабатываются на сервере приложения и никуда не передаются.
 */

export function run(cmd: string, args: string[], opts: { timeoutMs?: number; input?: Buffer } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "buffer",
        killSignal: "SIGKILL",
        // Tesseract с OpenMP на всех ядрах резко замедляется при параллельных запусках — ограничиваем потоки
        env: { ...process.env, OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT ?? "2" },
      },
      (err, stdout, stderr) => {
        if (err) reject(new ToolError(cmd, (stderr?.toString() || err.message).trim().split("\n").slice(-3).join(" ")));
        else resolve({ stdout, stderr: stderr.toString() });
      },
    );
    if (opts.input && child.stdin) {
      child.stdin.end(opts.input);
    }
  });
}

export class ToolError extends Error {
  constructor(public tool: string, message: string) {
    super(`${tool}: ${message}`);
    this.name = "ToolError";
  }
}

// Не более одного тяжёлого процесса OCR одновременно в пределах сервера
let ocrChain: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = ocrChain.then(fn, fn);
  ocrChain = next.catch(() => undefined);
  return next;
}

const availability = new Map<string, Promise<boolean>>();

export function toolAvailable(cmd: string, versionArg = "--version"): Promise<boolean> {
  if (!availability.has(cmd)) {
    availability.set(
      cmd,
      run(cmd, [versionArg], { timeoutMs: 10_000 }).then(
        () => true,
        (e) => (e instanceof ToolError && !/ENOENT/.test(e.message) ? true : false),
      ),
    );
  }
  return availability.get(cmd)!;
}

let langsCache: Promise<string[]> | null = null;

/** Установленные языки Tesseract. */
export function tesseractLanguages(): Promise<string[]> {
  if (!langsCache) {
    langsCache = run(process.env.TESSERACT_PATH || "tesseract", ["--list-langs"], { timeoutMs: 10_000 })
      .then(({ stdout, stderr }) =>
        (stdout.toString() + "\n" + stderr)
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^[a-z_]{3,}$/.test(l)),
      )
      .catch(() => []);
  }
  return langsCache;
}

/** Строка языков для распознавания: русский + кыргызский + английский (что установлено). */
export async function ocrLanguageString(): Promise<string | null> {
  const wanted = (process.env.OCR_LANGUAGES || "rus+kir+eng").split("+");
  const have = await tesseractLanguages();
  const langs = wanted.filter((l) => have.includes(l));
  return langs.length ? langs.join("+") : null;
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cc-doc-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** PDF → PNG-страницы (poppler pdftoppm). Возвращает буферы по порядку страниц. */
export async function pdfToImages(pdf: Buffer, dpi = 300, maxPages = 50): Promise<Buffer[]> {
  return withTempDir(async (dir) => {
    const input = path.join(dir, "in.pdf");
    await writeFile(input, pdf);
    await run("pdftoppm", ["-r", String(dpi), "-png", "-l", String(maxPages), input, path.join(dir, "p")], { timeoutMs: 300_000 });
    const files = (await readdir(dir)).filter((f) => f.startsWith("p") && f.endsWith(".png")).sort((a, b) => num(a) - num(b));
    return Promise.all(files.map((f) => readFile(path.join(dir, f))));
  });
}

function num(f: string) {
  return Number(/(\d+)\.png$/.exec(f)?.[1] ?? 0);
}

/** Текстовый слой PDF по страницам (pdftotext -layout). Пустой результат — скан без текста. */
export async function pdfText(pdf: Buffer): Promise<string[]> {
  return withTempDir(async (dir) => {
    const input = path.join(dir, "in.pdf");
    await writeFile(input, pdf);
    const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", input, "-"], { timeoutMs: 120_000 });
    const pages = stdout.toString("utf8").split("\f");
    if (pages.length && pages[pages.length - 1].trim() === "") pages.pop();
    return pages;
  });
}

/** HEIC/HEIF → JPEG (libheif heif-convert), если утилита установлена. */
export async function heicToJpeg(input: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const src = path.join(dir, "in.heic");
    const dst = path.join(dir, "out.jpg");
    await writeFile(src, input);
    await run("heif-convert", ["-q", "92", src, dst], { timeoutMs: 120_000 });
    return readFile(dst);
  });
}
