/**
 * `router.refresh()` without the risk of a full page load.
 *
 * When the RSC request of a refresh fails, Next falls back to a full browser navigation. On a dead
 * connection that throws away unsaved work (a half-drawn zone) or replaces the installed app with
 * the browser's offline page. So the server is probed first with a HEAD for the manifest: small,
 * dynamic-free, and never cached by the service worker (GET-only cache; the manifest is not cached).
 */
export async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch("/manifest.webmanifest", { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Refreshes the current route if the server answers; resolves to whether it did. */
export async function refreshIfReachable(router: { refresh(): void }): Promise<boolean> {
  const ok = await serverReachable();
  if (ok) router.refresh();
  return ok;
}
