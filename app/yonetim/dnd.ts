import {
  PointerSensor,
  type Announcements,
  type PointerSensorOptions,
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";

/** What every draggable (a people-list row or a zone-card chip) carries. */
export type DragData = { workerId: string; fromZoneId: string | null; name: string };

/** Droppable ids. Zone cards are `zone:<id>`; the map area is one droppable. */
export const MAP_DROP_ID = "map";
export const zoneDropId = (zoneId: string) => `zone:${zoneId}`;
export const zoneIdFromDropId = (id: unknown) =>
  typeof id === "string" && id.startsWith("zone:") ? id.slice("zone:".length) : null;

/**
 * Mouse and pen: a drag starts once the pointer has moved 5 px, so press-and-drag works at once and
 * a click (no movement) still opens the "Bölgeye ata" picker. A delay constraint here would cancel
 * every drag that moves before the delay ends.
 */
export const MOUSE_DRAG_ACTIVATION = { distance: 5 } as const;

/** Touch: hold 150 ms before a drag starts, so a tap opens the picker and a swipe scrolls the list. */
export const TOUCH_DRAG_ACTIVATION = { delay: 150, tolerance: 5 } as const;

/**
 * PointerSensor for mouse and pen only. Touch is left to TouchSensor, which can stop the page from
 * scrolling once a drag has started; a touch PointerSensor drag would be cancelled by the browser's
 * own panning (pointercancel).
 */
export class MousePenSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: (event: ReactPointerEvent, options: PointerSensorOptions) =>
        event.nativeEvent.pointerType !== "touch" && PointerSensor.activators[0].handler(event, options),
    },
  ];
}

/** Where the pointer is now: the activating event's position plus the drag delta. */
export function pointerPosition(activatorEvent: Event | null, delta: { x: number; y: number }) {
  if (!activatorEvent) return null;
  let start: { x: number; y: number } | null = null;
  if ("touches" in activatorEvent) {
    const touch = (activatorEvent as TouchEvent).touches[0] ?? (activatorEvent as TouchEvent).changedTouches[0];
    if (touch) start = { x: touch.clientX, y: touch.clientY };
  } else if ("clientX" in activatorEvent) {
    const e = activatorEvent as MouseEvent;
    start = { x: e.clientX, y: e.clientY };
  }
  return start && { x: start.x + delta.x, y: start.y + delta.y };
}

export const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "Kişiyi bir bölgeye sürükleyip bırakın. Klavyeyle atamak için kişi satırındaki “Bölgeye ata” seçeneğini kullanın.",
};

const nameOf = (data: unknown) => (data as { current?: DragData } | undefined)?.current?.name ?? "Kişi";

export const ANNOUNCEMENTS: Announcements = {
  onDragStart: ({ active }) => `${nameOf(active.data)} sürükleniyor.`,
  onDragOver: ({ active, over }) =>
    over ? `${nameOf(active.data)} bir bırakma alanının üzerinde.` : `${nameOf(active.data)} bırakma alanı dışında.`,
  onDragEnd: ({ active, over }) =>
    over ? `${nameOf(active.data)} bırakıldı.` : `${nameOf(active.data)} bırakılmadı.`,
  onDragCancel: ({ active }) => `${nameOf(active.data)} sürüklemesi iptal edildi.`,
};
