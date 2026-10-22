"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function NavTabs({ tabs }: { tabs: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname();
  const nav = useRef<HTMLElement>(null);
  // На телефоне лента вкладок прокручивается: активная вкладка не должна оставаться за краем экрана
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>("[aria-current=page]");
    if (el && nav.current && nav.current.scrollWidth > nav.current.clientWidth) nav.current.scrollLeft = el.offsetLeft - 16;
  }, [path]);
  return (
    <nav ref={nav} className="relative -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${active ? "border-blue-700 font-medium text-blue-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
