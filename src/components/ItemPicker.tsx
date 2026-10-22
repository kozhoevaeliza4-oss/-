"use client";

import { useEffect, useRef, useState } from "react";

type Item = { id: string; label: string; unit: string | null; object: string | null; section: string | null };

/** Выбор статьи работ с серверным поиском (для больших смет). Значение передаётся в скрытом поле name. */
export function ItemPicker({
  projectId,
  name = "workItemId",
  initial,
  required,
  onChange,
}: {
  projectId: string;
  name?: string;
  initial?: { id: string; label: string } | null;
  required?: boolean;
  onChange?: (item: Item | null) => void;
}) {
  const [q, setQ] = useState(initial?.label ?? "");
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(initial ?? null);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/items/search?q=${encodeURIComponent(q)}`);
        if (r.ok) setItems(await r.json());
      } catch {
        setItems([]);
      }
    }, 200);
  }, [q, open, projectId]);

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selected?.id ?? ""} required={required} />
      <input
        className="input"
        value={q}
        placeholder="Код или наименование статьи"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setSelected(null);
          onChange?.(null);
          setOpen(true);
        }}
        aria-invalid={required && !selected ? true : undefined}
      />
      {open && items.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white text-sm shadow-lg">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className="block w-full px-2 py-1.5 text-left hover:bg-slate-100"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSelected({ id: i.id, label: i.label });
                  setQ(i.label);
                  setOpen(false);
                  onChange?.(i);
                }}
              >
                {i.label}
                <span className="ml-1 text-xs text-slate-500">
                  {[i.object && `корп. ${i.object}`, i.section && `разд. ${i.section}`, i.unit].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {required && q && !selected && <p className="mt-1 text-xs text-amber-700">Выберите статью из списка</p>}
    </div>
  );
}
