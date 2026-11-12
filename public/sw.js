// Minimal service worker: makes the app installable and serves static assets cache-first.
// Pages (HTML), RSC/Server Action requests, Supabase and map tiles always go to the network,
// so a worker never sees a stale assignment. Bump CACHE to drop old assets.
const CACHE = "saha-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Same-origin, never-changing (hashed) build assets and the app icons. */
function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false; // Supabase, tile servers
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico"
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode === "navigate") return;
  const url = new URL(request.url);
  if (!isStaticAsset(url)) return; // default browser handling = network

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
