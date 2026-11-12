"use client";

import { useDraggable } from "@dnd-kit/core";
import type { DragData } from "./dnd";

type Props = {
  workerId: string;
  zoneId: string;
  name: string;
  /** Unassign (the × button). */
  onRemove: () => void;
  /** Dragging off; the × still works. */
  dragDisabled?: boolean;
};

/** A worker's chip on a zone card: drag it onto another card / polygon to move, × to unassign. */
export function AssignmentChip({ workerId, zoneId, name, onRemove, dragDisabled }: Props) {
  const data: DragData = { workerId, fromZoneId: zoneId, name };
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `chip:${zoneId}:${workerId}`,
    data,
    disabled: dragDisabled,
    attributes: { roleDescription: "sürüklenebilir kişi" },
  });

  return (
    <li
      ref={setNodeRef}
      data-chip-worker={workerId}
      className={`flex items-center rounded-full bg-zinc-100 text-xs text-zinc-700 ${isDragging ? "opacity-40" : ""}`}
    >
      <span
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        aria-label={`${name}: başka bölgeye taşımak için sürükleyin`}
        className="cursor-grab touch-manipulation select-none py-0.5 pl-2 pr-1 active:cursor-grabbing"
      >
        {name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${name} atamasını kaldır`}
        className="mr-0.5 flex h-5 w-5 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"
      >
        {/* An icon, not a "×" character, so the chip's text is just the name. */}
        <svg viewBox="0 0 10 10" aria-hidden className="h-2.5 w-2.5" stroke="currentColor" strokeWidth="1.6">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>
    </li>
  );
}
