"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js in production builds only (in development a service worker would get in the
 * way of hot reloading).
 */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not installable without it, but the app itself works the same.
    });
  }, []);
  return null;
}
