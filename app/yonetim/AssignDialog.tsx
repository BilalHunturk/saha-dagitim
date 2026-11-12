"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type ZoneRef = { id: string; name: string; color: string };

/** A centred modal with a backdrop; Escape or a backdrop click cancels. */
export function Modal({
  title,
  onClose,
  children,
  labelledBy = "modal-title",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    boxRef.current?.querySelector<HTMLElement>("button, [href], input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="flex max-h-[85dvh] w-full max-w-sm flex-col rounded-xl bg-white p-4 shadow-xl"
      >
        <h2 id={labelledBy} className="text-base font-semibold text-zinc-900">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

type Props = {
  workerName: string;
  /** The zone the worker was dropped on. */
  target: ZoneRef;
  /** Zones the worker is already in. */
  current: ZoneRef[];
  onAdd: () => void;
  onMove: (fromZoneId: string) => void;
  onCancel: () => void;
};

const joinNames = (zones: ZoneRef[]) => zones.map((z) => z.name).join(", ");

/**
 * "Ekle / Taşı" question when a worker who is already assigned is dropped on another zone.
 * With one current zone, Taşı moves from it directly; with several, the user picks which one.
 */
export function AssignDialog({ workerName, target, current, onAdd, onMove, onCancel }: Props) {
  const [pickingSource, setPickingSource] = useState(false);

  return (
    <Modal title={`${target.name} bölgesine ata`} onClose={onCancel} labelledBy="assign-dialog-title">
      <p className="mt-2 text-sm text-zinc-700">
        {workerName} şu bölgelerde görevli: {joinNames(current)}.
      </p>

      {pickingSource ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-zinc-900">Hangi bölgeden taşınsın?</p>
          <ul className="mt-2 space-y-1">
            {current.map((z) => (
              <li key={z.id}>
                <button
                  type="button"
                  onClick={() => onMove(z.id)}
                  className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50"
                >
                  <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: z.color }} />
                  {z.name} bölgesinden taşı
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPickingSource(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              Geri
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => (current.length === 1 ? onMove(current[0].id) : setPickingSource(true))}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Taşı
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Buraya da ekle
          </button>
        </div>
      )}
    </Modal>
  );
}

/**
 * The non-drag way to assign ("Bölgeye ata"): tap a person, pick a zone. Used on phones, where the
 * people list and the zone cards are not on screen together, and from the keyboard.
 * The choice goes through the same resolveDrop rules as a drop.
 */
export function ZonePicker({
  workerName,
  zones,
  assignedZoneIds,
  onPick,
  onCancel,
}: {
  workerName: string;
  zones: ZoneRef[];
  assignedZoneIds: string[];
  onPick: (zoneId: string) => void;
  onCancel: () => void;
}) {
  return (
    <Modal title="Bölgeye ata" onClose={onCancel} labelledBy="zone-picker-title">
      <p className="mt-1 text-sm text-zinc-600">{workerName}</p>
      {zones.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Henüz bölge yok.</p>
      ) : (
        <ul aria-label="Bölgeler" className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {zones.map((z) => {
            const assigned = assignedZoneIds.includes(z.id);
            return (
              <li key={z.id}>
                <button
                  type="button"
                  disabled={assigned}
                  onClick={() => onPick(z.id)}
                  className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 disabled:cursor-default disabled:bg-zinc-50 disabled:text-zinc-500"
                >
                  <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: z.color }} />
                  <span className="min-w-0 flex-1 truncate">{z.name}</span>
                  {assigned && <span className="shrink-0 text-xs">Atanmış</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          Vazgeç
        </button>
      </div>
    </Modal>
  );
}
