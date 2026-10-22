"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/components/forms";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Page = { id: string; file: File; url: string | null };

/**
 * Съёмка/выбор страниц акта. Оригиналы файлов отправляются без изменений (сжатие и поворот — только на сервере
 * в отдельной копии для распознавания).
 */
export function CaptureForm({ action, maxMb, submitLabel = "Распознать", extra }: { action: A; maxMb: number; submitLabel?: string; extra?: React.ReactNode }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(action, null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const extraRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => pages.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [pages]);

  const add = (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const next: Page[] = [];
    for (const f of Array.from(list)) {
      if (f.size > maxMb * 1024 * 1024) {
        setError(`Файл «${f.name}» больше ${maxMb} МБ`);
        continue;
      }
      const previewable = /^image\/(jpeg|png|webp)$/.test(f.type);
      next.push({ id: `${f.name}-${f.size}-${Math.random()}`, file: f, url: previewable ? URL.createObjectURL(f) : null });
    }
    setPages((p) => [...p, ...next]);
  };
  const move = (i: number, d: -1 | 1) =>
    setPages((p) => {
      const a = [...p];
      const j = i + d;
      if (j < 0 || j >= a.length) return a;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
  const remove = (i: number) => setPages((p) => p.filter((_, k) => k !== i));

  const submit = () => {
    if (!pages.length) {
      setError("Добавьте хотя бы одну страницу");
      return;
    }
    const fd = new FormData();
    pages.forEach((p) => fd.append("files", p.file, p.file.name));
    extraRef.current?.querySelectorAll<HTMLInputElement>("input").forEach((i) => {
      if (i.type === "checkbox") {
        if (i.checked) fd.append(i.name, "on");
      } else fd.append(i.name, i.value);
    });
    startTransition(() => formAction(fd));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn-primary py-4 text-base" onClick={() => camera.current?.click()} disabled={pending}>
          📷 Сфотографировать страницу
        </button>
        <button type="button" className="btn-secondary py-4 text-base" onClick={() => gallery.current?.click()} disabled={pending}>
          Выбрать из галереи / файлы
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={gallery} type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif,application/pdf" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

      {pages.length > 0 && (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {pages.map((p, i) => (
            <li key={p.id} className="card overflow-hidden">
              <div className="flex aspect-[3/4] items-center justify-center bg-slate-100">
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={`Страница ${i + 1}`} className="h-full w-full object-contain" />
                ) : (
                  <span className="p-2 text-center text-xs text-slate-500">{p.file.name}<br />(предпросмотр недоступен)</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 p-2 text-xs">
                <span className="font-medium">Стр. {i + 1}</span>
                <span className="flex gap-1">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Выше">↑</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => move(i, 1)} disabled={i === pages.length - 1} aria-label="Ниже">↓</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => remove(i)} aria-label="Удалить">✕</button>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div ref={extraRef}>{extra}</div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {state && !state.ok && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald-700">{state.message}</p>}
      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button type="button" className="btn-primary w-full py-3 text-base sm:w-auto" onClick={submit} disabled={pending || !pages.length}>
          {pending ? "Загрузка…" : `${submitLabel}${pages.length ? ` (${pages.length} стр.)` : ""}`}
        </button>
      </div>
    </div>
  );
}
