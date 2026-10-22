"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Периодическое обновление страницы, пока идёт фоновая обработка. */
export function AutoRefresh({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}
