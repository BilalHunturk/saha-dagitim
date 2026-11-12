"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { refreshIfReachable } from "@/lib/safe-refresh";
import { AUTO_REFRESH_MS, shouldAutoRefresh } from "@/lib/worker-refresh";

/**
 * Keeps the worker screen's server data fresh without a manual reload: re-reads it when the app
 * returns to the foreground (visibilitychange, focus, bfcache pageshow), when the device comes
 * back online, and every AUTO_REFRESH_MS while visible. `refresh` is the "Yenile" button.
 *
 * `router.refresh()` re-renders the server components in place: client state (map view,
 * basemap, selection) is kept, and the layout's requireRole runs again, so a deactivated worker
 * is sent to /giris?hata=pasif. It only runs when the server answers (refreshIfReachable): on a
 * dead connection the screen keeps its data and shows "Bağlantı yok".
 */
export function useWorkerRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [offline, setOffline] = useState(false);
  const lastAt = useRef<number | null>(null);

  const refresh = useCallback(() => {
    lastAt.current = Date.now();
    startTransition(async () => {
      setOffline(!(await refreshIfReachable(router)));
    });
  }, [router]);

  useEffect(() => {
    const auto = () => {
      const run = shouldAutoRefresh({
        visible: document.visibilityState === "visible",
        online: navigator.onLine,
        now: Date.now(),
        lastAt: lastAt.current,
      });
      if (run) refresh();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) auto(); // restored from the back/forward cache
    };
    const timer = window.setInterval(auto, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", auto);
    window.addEventListener("focus", auto);
    window.addEventListener("online", auto);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", auto);
      window.removeEventListener("focus", auto);
      window.removeEventListener("online", auto);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refresh]);

  return { refresh, pending, offline };
}
