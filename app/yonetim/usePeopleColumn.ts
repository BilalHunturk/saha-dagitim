"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the desktop (lg+) people column is shown.
 *
 * - "open" / "closed": the manager's choice (remembered in localStorage), or, with no choice yet,
 *   the default for the window width: open at ≥1280px, collapsed below (the map is narrow there).
 * - "auto": only during the server render and hydration, where the width is unknown. The caller
 *   renders the width default with CSS (`xl:`), so nothing jumps.
 */
export type PeopleColumn = "open" | "closed" | "auto";

export const PEOPLE_COLUMN_STORAGE_KEY = "saha.peopleColumn";
const WIDE_QUERY = "(min-width: 1280px)";

const listeners = new Set<() => void>();
/** Fallback when storage is unavailable (private mode): the choice lasts for this page load. */
let memory: "open" | "closed" | null = null;

function readStored(): "open" | "closed" | null {
  try {
    const value = window.localStorage.getItem(PEOPLE_COLUMN_STORAGE_KEY);
    if (value === "open" || value === "closed") return value;
  } catch {
    // Storage unavailable: fall through to the in-memory choice.
  }
  return memory;
}

function getSnapshot(): PeopleColumn {
  return readStored() ?? (window.matchMedia(WIDE_QUERY).matches ? "open" : "closed");
}

function subscribe(listener: () => void) {
  const mq = window.matchMedia(WIDE_QUERY);
  listeners.add(listener);
  window.addEventListener("storage", listener);
  mq.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
    mq.removeEventListener("change", listener);
  };
}

export function usePeopleColumn(): [PeopleColumn, (open: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, () => "auto" as const);
  const set = useCallback((open: boolean) => {
    memory = open ? "open" : "closed";
    try {
      window.localStorage.setItem(PEOPLE_COLUMN_STORAGE_KEY, memory);
    } catch {
      // Not remembered across reloads; `memory` keeps it for now.
    }
    listeners.forEach((l) => l());
  }, []);
  return [value, set];
}
