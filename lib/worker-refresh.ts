/**
 * Pure helpers for keeping the worker screen (/gorevim) fresh. The screen re-reads its data
 * (router.refresh) when the app comes back to the foreground or online, and on a timer while
 * visible. No imports, so it is safe in Client Components.
 */

/** Re-read the data this often while the page is visible. */
export const AUTO_REFRESH_MS = 60_000;

/** Foreground events come in bursts (focus + visibilitychange + pageshow); one refresh is enough. */
export const MIN_REFRESH_GAP_MS = 3_000;

/** Whether an automatic trigger should refresh now. `lastAt` is when the previous refresh started. */
export function shouldAutoRefresh(s: { visible: boolean; online: boolean; now: number; lastAt: number | null }): boolean {
  if (!s.visible || !s.online) return false;
  return s.lastAt === null || s.now - s.lastAt >= MIN_REFRESH_GAP_MS;
}

/**
 * Identity of the zone set for map fitting: which zones, and their shapes. Equal keys mean the
 * map view can stay where the worker left it; a different key means refit to the new zones.
 */
export function zonesKey(zones: { id: string; geojson: GeoJSON.Polygon }[]): string {
  return JSON.stringify(zones.map((z) => [z.id, z.geojson.coordinates]));
}

const CLOCK = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  // Fixed zone: the same text on the server (UTC on Vercel) and the phone, so no hydration
  // mismatch. The app is for field teams in Turkey (Turkish mobile numbers only).
  timeZone: "Europe/Istanbul",
});

/** "HH:MM" in Turkey time. */
export function formatClock(iso: string): string {
  return CLOCK.format(new Date(iso));
}
