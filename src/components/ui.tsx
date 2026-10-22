import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export type Tone = "green" | "yellow" | "red" | "grey" | "blue";

const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/30",
  yellow: "bg-amber-50 text-amber-900 ring-amber-600/30",
  red: "bg-red-50 text-red-800 ring-red-600/30",
  grey: "bg-slate-100 text-slate-700 ring-slate-500/30",
  blue: "bg-blue-50 text-blue-800 ring-blue-600/30",
};

const DOTS: Record<Tone, string> = {
  green: "bg-emerald-600",
  yellow: "bg-amber-500",
  red: "bg-red-600",
  grey: "bg-slate-400",
  blue: "bg-blue-600",
};

/** Статус: цвет всегда сопровождается текстом. */
export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} />
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: Tone;
}) {
  const body = (
    <div className={`card h-full p-3 ${href ? "transition hover:border-blue-400 hover:shadow" : ""}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      {/* Длинные суммы набираются мельче и переносятся, а не обрезаются краем карточки */}
      <div className={`mt-1 font-semibold tabular-nums leading-tight [overflow-wrap:anywhere] ${typeof value === "string" && value.length > 14 ? "text-base" : "text-lg"} ${tone === "red" ? "text-red-700" : tone === "yellow" ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

export function DemoBanner() {
  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <strong>Демонстрационный проект.</strong> Все данные тестовые и не являются реальными показателями.
    </div>
  );
}
