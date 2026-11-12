"use client";

import { useCallback, useSyncExternalStore } from "react";
import { BASEMAP_IDS, BASEMAP_LABELS, BASEMAP_STORAGE_KEY, isBasemapId, type BasemapId } from "./basemaps";

const DEFAULT_BASEMAP: BasemapId = "satellite";
const listeners = new Set<() => void>();

function readStored(): BasemapId {
  try {
    const value = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
    return isBasemapId(value) ? value : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The basemap choice, persisted in localStorage. Renders the default on the server. */
export function useStoredBasemap(): [BasemapId, (id: BasemapId) => void] {
  const value = useSyncExternalStore(subscribe, readStored, () => DEFAULT_BASEMAP);
  const set = useCallback((id: BasemapId) => {
    try {
      window.localStorage.setItem(BASEMAP_STORAGE_KEY, id);
    } catch {
      // Storage unavailable (private mode): the choice just isn't remembered.
    }
    listeners.forEach((l) => l());
  }, []);
  return [value, set];
}

type Props = { value: BasemapId; onChange: (id: BasemapId) => void; className?: string };

/** "Uydu" / "Sokak" segmented switch. */
export function BasemapToggle({ value, onChange, className }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Harita altlığı"
      className={`inline-flex rounded-lg bg-white p-0.5 text-sm font-medium shadow-md ring-1 ring-black/10 ${className ?? ""}`}
    >
      {BASEMAP_IDS.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`rounded-md px-3 py-1.5 ${
            value === id ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          {BASEMAP_LABELS[id]}
        </button>
      ))}
    </div>
  );
}
