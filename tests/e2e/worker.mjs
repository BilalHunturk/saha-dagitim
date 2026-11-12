// Browser check of the worker screen (/gorevim) at 375×812 and of the PWA pieces.
//
// Needs: local Supabase running, `next dev` on BASE_URL (default http://localhost:3100) and
// Google Chrome. Optionally PROD_URL (a `next start` of a production build) for the service
// worker checks, which only run in production builds.
// Run: node tests/e2e/worker.mjs [screenshotDir]
//
// It creates two temporary workers with the service role (+905009999911 assigned to two existing
// zones, +905009999912 with no assignment), signs in with a random password that is never
// printed, and hard-deletes both workers and their assignments at the end. Zones and other
// people's assignments are only read. While a worker page is open it also ends and re-adds one of
// that temporary worker's assignments, to check that the screen refreshes itself.
// Refuses to run unless NEXT_PUBLIC_SUPABASE_URL is local (tests/e2e/local-guard.mjs).

import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { assertLocalSupabase } from "./local-guard.mjs";

process.loadEnvFile(".env.local");
assertLocalSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL);
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PROD = process.env.PROD_URL ?? null;
const SHOTS = process.argv[2] ?? "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const ASSIGNED = { phone: "+905009999911", name: "E2E Dağıtıcı Atanmış", password: crypto.randomUUID() };
const UNASSIGNED = { phone: "+905009999912", name: "E2E Dağıtıcı Boş", password: crypto.randomUUID() };
const ANKARA = { latitude: 39.9208, longitude: 32.8541 }; // Kızılay

async function createWorker({ phone, name, password }) {
  const { data, error } = await service.auth.admin.createUser({
    email: `${phone.slice(1)}@saha.local`,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const { error: pErr } = await service
    .from("profiles")
    .insert({ id: data.user.id, full_name: name, phone, role: "worker" });
  if (pErr) throw pErr;
  return data.user.id;
}

async function cleanup() {
  const { data: workers } = await service
    .from("profiles")
    .select("id")
    .in("phone", [ASSIGNED.phone, UNASSIGNED.phone]);
  for (const w of workers ?? []) {
    const { error } = await service.from("assignments").delete().eq("worker_id", w.id);
    if (error) throw error;
    await service.auth.admin.deleteUser(w.id); // cascades to the profile
  }
}

const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? "chrome",
  headless: process.env.HEADED ? false : true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const MOBILE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function newPage(base, extra = {}) {
  const context = await browser.newContext({ ...MOBILE, baseURL: base, ...extra });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  return { context, page };
}

async function signIn(page, base, { phone, password }) {
  await page.goto(`${base}/giris`);
  await page.locator('input[name="phone"]').fill(`0${phone.slice(3)}`);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(`${base}/gorevim`, { timeout: 20000 });
}

async function waitMapIdle(page) {
  await page.waitForFunction(() => window.__sahaMap && window.__sahaMap.loaded(), null, { timeout: 30000 });
  await page.evaluate(
    () => new Promise((r) => (window.__sahaMap.loaded() ? r() : window.__sahaMap.once("idle", r))),
  );
}

const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Whether the map's visible bounds contain all the given polygons. */
const mapContains = (page, polys) =>
  page.evaluate((polys) => {
    const b = window.__sahaMap.getBounds();
    return polys.every((p) => p.coordinates[0].every(([lng, lat]) => b.contains([lng, lat])));
  }, polys);

async function checkPwaFiles(base, label) {
  const res = await fetch(`${base}/manifest.webmanifest`);
  const m = res.ok ? await res.json() : {};
  check(`${label}: /manifest.webmanifest 200`, res.status === 200, String(res.status));
  check(
    `${label}: manifest has the brief's values`,
    m.name === "Saha Dağıtım" &&
      m.short_name === "Saha" &&
      m.start_url === "/" &&
      m.display === "standalone" &&
      m.lang === "tr" &&
      m.theme_color === "#0f172a" &&
      m.background_color === "#0f172a" &&
      m.icons?.length === 3 &&
      m.icons.some((i) => i.purpose === "maskable"),
  );
  for (const icon of m.icons ?? []) {
    const r = await fetch(`${base}${icon.src}`);
    const type = r.headers.get("content-type");
    const bytes = new Uint8Array(await r.arrayBuffer());
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    check(`${label}: ${icon.src} 200 image/png`, r.status === 200 && type === "image/png" && png, `${r.status} ${type}`);
  }
}

try {
  await cleanup();
  const assignedId = await createWorker(ASSIGNED);
  await createWorker(UNASSIGNED);

  const { data: zones, error: zErr } = await service
    .from("zones_geojson")
    .select("id, name, geojson")
    .order("name")
    .limit(2);
  if (zErr) throw zErr;
  if (zones.length < 2) throw new Error("Need at least two active zones (run tests/e2e/seed-sample-zones.mjs)");
  const { count: totalZones } = await service
    .from("zones")
    .select("id", { count: "exact", head: true })
    .is("archived_at", null);
  const { error: aErr } = await service
    .from("assignments")
    .insert(zones.map((z) => ({ zone_id: z.id, worker_id: assignedId })));
  if (aErr) throw aErr;

  // --- Assigned worker, location granted (fake Ankara position) ---------------------------
  {
    const { context, page } = await newPage(BASE, { geolocation: ANKARA, permissions: ["geolocation"] });
    await signIn(page, BASE, ASSIGNED);
    check("worker signs in and lands on /gorevim", page.url() === `${BASE}/gorevim`);
    await page.locator("[data-zone-id]").first().waitFor();
    await waitMapIdle(page);

    const listed = await page.locator("[data-zone-id]").evaluateAll((els) => els.map((e) => e.dataset.zoneId));
    check(
      "list shows exactly the two assigned zones (RLS)",
      listed.length === 2 && zones.every((z) => listed.includes(z.id)),
      `${listed.length} of ${totalZones} zones`,
    );
    for (const z of zones) {
      check(`list shows name "${z.name}"`, (await page.locator(`[data-zone-id="${z.id}"]`).innerText()).includes(z.name));
    }
    const renderedIds = await page.evaluate(() => [
      ...new Set(window.__sahaMap.queryRenderedFeatures({ layers: ["zones-fill"] }).map((f) => f.properties.id)),
    ]);
    check("both zones are rendered on the map", zones.every((z) => renderedIds.includes(z.id)), renderedIds.length);
    check("both zones fit in view on open", await mapContains(page, zones.map((z) => z.geojson)));
    check("no horizontal scroll at 375px", await noHorizontalScroll(page));
    const visibleBasemap = await page.evaluate(() =>
      window.__sahaMap.getLayoutProperty("basemap-satellite", "visibility"),
    );
    check("satellite basemap by default", visibleBasemap === "visible");

    const small = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent !== null && !b.closest(".maplibregl-ctrl-attrib"))
        .map((b) => ({ label: b.getAttribute("aria-label") || b.textContent.trim(), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
        .filter((b) => b.h < 44 || b.w < 44),
    );
    check("touch targets are at least 44px", small.length === 0, JSON.stringify(small));
    await page.screenshot({ path: join(SHOTS, "w01-fit.png") });

    // Tap a list item → zoom to that zone.
    const target = zones[1];
    const zoomBefore = await page.evaluate(() => window.__sahaMap.getZoom());
    await page.locator(`[data-zone-id="${target.id}"]`).click();
    await page.waitForFunction(() => !window.__sahaMap.isMoving(), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.waitForFunction(() => !window.__sahaMap.isMoving(), null, { timeout: 10000 });
    const after = await page.evaluate(() => ({ zoom: window.__sahaMap.getZoom(), c: window.__sahaMap.getCenter().toArray() }));
    const [[w, s], [e, n]] = [
      [Math.min(...target.geojson.coordinates[0].map((p) => p[0])), Math.min(...target.geojson.coordinates[0].map((p) => p[1]))],
      [Math.max(...target.geojson.coordinates[0].map((p) => p[0])), Math.max(...target.geojson.coordinates[0].map((p) => p[1]))],
    ];
    check(
      "tapping a list item zooms to that zone",
      after.zoom > zoomBefore && after.c[0] >= w && after.c[0] <= e && after.c[1] >= s && after.c[1] <= n &&
        (await mapContains(page, [target.geojson])),
      `zoom ${zoomBefore.toFixed(2)} -> ${after.zoom.toFixed(2)}`,
    );
    check(
      "tapped item is marked current",
      (await page.locator(`[data-zone-id="${target.id}"]`).getAttribute("aria-current")) === "true",
    );
    await page.screenshot({ path: join(SHOTS, "w02-zoomed.png") });

    // Basemap toggle.
    await page.getByRole("radio", { name: "Sokak" }).click();
    await waitMapIdle(page);
    const vis = await page.evaluate(() => [
      window.__sahaMap.getLayoutProperty("basemap-streets", "visibility"),
      window.__sahaMap.getLayoutProperty("basemap-satellite", "visibility"),
    ]);
    check("Sokak shows the streets basemap", vis[0] === "visible" && vis[1] === "none");
    await page.screenshot({ path: join(SHOTS, "w03-streets.png") });
    await page.getByRole("radio", { name: "Uydu" }).click();

    // Location: granted fake position near Kızılay.
    const geoRequests = [];
    page.on("request", (r) => {
      const u = r.url();
      if (r.method() !== "GET" || u.includes(String(ANKARA.latitude)) || u.includes(String(ANKARA.longitude))) {
        geoRequests.push(`${r.method()} ${u}`);
      }
    });
    const locate = page.getByRole("button", { name: "Konumumu göster" });
    await locate.waitFor();
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Konumumu göster");
      return b && !b.disabled;
    });
    await locate.click();
    await page.locator(".maplibregl-user-location-dot").waitFor({ timeout: 10000 });
    await page.waitForFunction(() => !window.__sahaMap.isMoving(), null, { timeout: 10000 });
    await page.waitForTimeout(1500);
    const geo = await page.evaluate((p) => {
      const c = window.__sahaMap.getCenter();
      return { dlng: Math.abs(c.lng - p.longitude), dlat: Math.abs(c.lat - p.latitude) };
    }, ANKARA);
    check("Konumumu göster shows the dot and centres on the position", geo.dlng < 0.001 && geo.dlat < 0.001, JSON.stringify(geo));
    check("location button is pressed while tracking", (await locate.getAttribute("aria-pressed")) === "true");
    // (Next's route announcer is also role="alert", so match the location messages.)
    check(
      "no location error while permission is granted",
      (await page.getByRole("alert").filter({ hasText: /Konum/ }).count()) === 0,
    );
    check(
      "MapLibre's own geolocate button is hidden (ours replaces it)",
      !(await page.locator(".maplibregl-ctrl-geolocate").isVisible()),
    );
    check("position is not sent to any server", geoRequests.length === 0, geoRequests.join(", "));
    await page.screenshot({ path: join(SHOTS, "w04-location.png") });

    // Worker cannot open /yonetim.
    await page.goto(`${BASE}/yonetim`);
    await page.waitForURL(`${BASE}/gorevim`, { timeout: 15000 });
    check("worker opening /yonetim is redirected to /gorevim", page.url() === `${BASE}/gorevim`);
    await page.goto(`${BASE}/yonetim/kisiler`);
    await page.waitForURL(`${BASE}/gorevim`, { timeout: 15000 });
    check("worker opening /yonetim/kisiler is redirected to /gorevim", page.url() === `${BASE}/gorevim`);

    const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    check("dev: no service worker registered", regs === 0, String(regs));
    await context.close();
  }

  // --- Assigned worker, location permission denied -----------------------------------------
  {
    const { context, page } = await newPage(BASE);
    await signIn(page, BASE, ASSIGNED);
    await waitMapIdle(page);
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Konumumu göster");
      return b && !b.disabled;
    });
    await page.getByRole("button", { name: "Konumumu göster" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Konum izni verilmedi" });
    await alert.waitFor({ timeout: 10000 });
    check("denied permission shows 'Konum izni verilmedi'", (await alert.innerText()).trim() === "Konum izni verilmedi");
    check(
      "location button not pressed after denial",
      (await page.getByRole("button", { name: "Konumumu göster" }).getAttribute("aria-pressed")) === "false",
    );
    check("no horizontal scroll with the alert", await noHorizontalScroll(page));
    await page.screenshot({ path: join(SHOTS, "w05-denied.png") });
    await context.close();
  }

  // --- Assigned worker: the open screen picks up assignment changes without a reload ----------
  {
    const { context, page } = await newPage(BASE);
    await signIn(page, BASE, ASSIGNED);
    await page.locator("[data-zone-id]").first().waitFor();
    await waitMapIdle(page);
    const yenile = page.getByRole("button", { name: "Yenile", exact: true });
    const listText = () => page.locator("section[aria-label='Bölgelerim']").innerText();
    check(
      "shows 'Son güncelleme: HH:MM' and a Yenile button",
      /Son güncelleme: \d{2}:\d{2}/.test(await listText()) && (await yenile.isVisible()),
    );
    const listedIds = () => page.locator("[data-zone-id]").evaluateAll((els) => els.map((e) => e.dataset.zoneId));
    const settle = async () => {
      await page.waitForFunction(() => !window.__sahaMap.isMoving(), null, { timeout: 10000 });
      await page.waitForTimeout(300);
      await page.waitForFunction(() => !window.__sahaMap.isMoving(), null, { timeout: 10000 });
    };
    const view = () => page.evaluate(() => ({ zoom: window.__sahaMap.getZoom(), c: window.__sahaMap.getCenter().toArray() }));
    const streetsVisible = () =>
      page.evaluate(() => window.__sahaMap.getLayoutProperty("basemap-streets", "visibility") === "visible");
    const refreshResponse = () =>
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/gorevim" && r.request().method() === "GET" && !!r.request().headers()["rsc"],
        { timeout: 15000 },
      );

    // Move the view and switch the basemap, then refresh with nothing changed: both must stay.
    await page.getByRole("radio", { name: "Sokak" }).click();
    await waitMapIdle(page);
    await page.locator(`[data-zone-id="${zones[0].id}"]`).click();
    await settle();
    const before = await view();
    await page.evaluate(() => (window.__noReload = true));
    const same = refreshResponse();
    await yenile.click();
    await same;
    await yenile.waitFor(); // label is back from "Yenileniyor…"
    await page.waitForTimeout(500);
    const after = await view();
    check(
      "Yenile with no change keeps the map view",
      Math.abs(after.zoom - before.zoom) < 1e-6 &&
        Math.abs(after.c[0] - before.c[0]) < 1e-9 &&
        Math.abs(after.c[1] - before.c[1]) < 1e-9,
      `zoom ${before.zoom.toFixed(3)} -> ${after.zoom.toFixed(3)}`,
    );
    check("Yenile with no change keeps the basemap (Sokak)", await streetsVisible());
    check(
      "Yenile with no change keeps the selected zone",
      (await page.locator(`[data-zone-id="${zones[0].id}"]`).getAttribute("aria-current")) === "true",
    );

    // The manager withdraws zone 0 while the screen is open; the app comes back to the foreground.
    await page.waitForTimeout(3500); // past the burst guard after the Yenile click
    const { error: endErr } = await service
      .from("assignments")
      .update({ ended_at: new Date().toISOString() })
      .eq("worker_id", assignedId)
      .eq("zone_id", zones[0].id)
      .is("ended_at", null);
    if (endErr) throw endErr;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => document.querySelectorAll("[data-zone-id]").length === 1, null, { timeout: 15000 });
    await settle();
    const remaining = await listedIds();
    check(
      "visibilitychange: withdrawn zone disappears from the list without navigation",
      remaining.length === 1 && remaining[0] === zones[1].id && page.url() === `${BASE}/gorevim` &&
        (await page.evaluate(() => window.__noReload === true)),
      JSON.stringify(remaining),
    );
    const drawn = await page.evaluate(() => [
      ...new Set(window.__sahaMap.queryRenderedFeatures({ layers: ["zones-fill"] }).map((f) => f.properties.id)),
    ]);
    check("visibilitychange: the map layer drops the withdrawn zone", !drawn.includes(zones[0].id), JSON.stringify(drawn));
    check("visibilitychange: the map refits to the remaining zone", await mapContains(page, [zones[1].geojson]));
    check("visibilitychange: the basemap stays Sokak", await streetsVisible());
    await page.screenshot({ path: join(SHOTS, "w08-refreshed.png") });

    // The assignment comes back; the device reports it is online again.
    await page.waitForTimeout(3500);
    const { error: reErr } = await service.from("assignments").insert({ zone_id: zones[0].id, worker_id: assignedId });
    if (reErr) throw reErr;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() => document.querySelectorAll("[data-zone-id]").length === 2, null, { timeout: 15000 });
    await settle();
    check(
      "online: a new assignment appears without navigation, and the map fits both zones",
      (await page.evaluate(() => window.__noReload === true)) && (await mapContains(page, zones.map((z) => z.geojson))),
    );
    check("no horizontal scroll with the refresh controls", await noHorizontalScroll(page));

    // No connection: Yenile keeps the screen (no full-page fallback) and says so.
    await page.waitForTimeout(3500);
    await context.setOffline(true);
    await yenile.click();
    await page.getByText("Bağlantı yok").waitFor({ timeout: 10000 });
    check(
      "offline: Yenile keeps the zones on screen and shows 'Bağlantı yok'",
      (await page.locator("[data-zone-id]").count()) === 2 && (await page.evaluate(() => window.__noReload === true)),
    );
    await context.setOffline(false);
    await context.close();
  }

  // --- Unassigned worker: empty state -------------------------------------------------------
  {
    const { context, page } = await newPage(BASE);
    await signIn(page, BASE, UNASSIGNED);
    const empty = page.getByText("Henüz görev atanmadı. Yöneticinizle iletişime geçin.");
    await empty.waitFor({ timeout: 10000 });
    check("unassigned worker sees the empty-state message", await empty.isVisible());
    check("empty state: no map, no list", (await page.locator(".maplibregl-map, [data-zone-id]").count()) === 0);
    check(
      "empty state: shows 'Son güncelleme' and a Yenile button",
      /Son güncelleme: \d{2}:\d{2}/.test(await page.locator("main").innerText()) &&
        (await page.getByRole("button", { name: "Yenile", exact: true }).isVisible()),
    );
    check("empty state: no horizontal scroll", await noHorizontalScroll(page));
    await page.screenshot({ path: join(SHOTS, "w06-empty.png") });
    await context.close();
  }

  await checkPwaFiles(BASE, "dev");

  // --- Production build: service worker -----------------------------------------------------
  if (PROD) {
    await checkPwaFiles(PROD, "prod");
    const { context, page } = await newPage(PROD);
    await signIn(page, PROD, ASSIGNED);
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return { script: reg.active?.scriptURL, scope: reg.scope };
    });
    check("prod: service worker registers (/sw.js, scope /)", sw.script === `${PROD}/sw.js` && sw.scope === `${PROD}/`, JSON.stringify(sw));

    // Reload twice: the SW now controls the page and has cached the static assets.
    await page.reload();
    await page.locator("[data-zone-id]").first().waitFor();
    const staticFromSw = [];
    const htmlResponses = [];
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/_next/static/") && r.fromServiceWorker()) staticFromSw.push(u.pathname);
      if (r.request().resourceType() === "document") htmlResponses.push({ url: r.url(), fromSw: r.fromServiceWorker(), status: r.status() });
    });
    await page.reload();
    await page.locator("[data-zone-id]").first().waitFor();
    check("prod: page is controlled by the service worker", await page.evaluate(() => !!navigator.serviceWorker.controller));
    check(
      "prod: HTML comes from the network, not the SW cache",
      htmlResponses.length > 0 && htmlResponses.every((r) => !r.fromSw && r.status === 200),
      JSON.stringify(htmlResponses),
    );
    check("prod: static assets are served cache-first by the SW", staticFromSw.length > 0, `${staticFromSw.length} files`);
    const cached = await page.evaluate(async () => {
      const urls = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const req of await cache.keys()) urls.push(new URL(req.url).pathname + new URL(req.url).search);
      }
      return urls;
    });
    const notStatic = cached.filter(
      (u) => !(u.startsWith("/_next/static/") || u.startsWith("/icons/") || u.split("?")[0] === "/favicon.ico"),
    );
    check(
      "prod: SW cache holds only static assets (no HTML, RSC, Supabase or tiles)",
      cached.length > 0 && notStatic.length === 0,
      `${cached.length} entries${notStatic.length ? `; unexpected: ${notStatic.join(", ")}` : ""}`,
    );
    check("prod: no horizontal scroll", await noHorizontalScroll(page));

    // The map still works under the SW (its worker .mjs is a cached static asset): tiles load
    // and nothing fails in the console. No __sahaMap handle in production, so check from outside.
    const consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    let tiles = 0;
    page.on("response", (r) => {
      if (/arcgisonline|openstreetmap/.test(r.url()) && r.ok()) tiles++;
    });
    await page.reload();
    await page.locator(".maplibregl-canvas").waitFor();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    check("prod: map loads tiles under the SW", tiles > 0, `${tiles} tiles`);
    check("prod: no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.screenshot({ path: join(SHOTS, "w07-prod.png") });
    await context.close();
  }
} catch (e) {
  check("script ran without error", false, e.message);
} finally {
  await browser.close();
  await cleanup();
  const { data: left } = await service.from("profiles").select("id").in("phone", [ASSIGNED.phone, UNASSIGNED.phone]);
  check("temporary workers removed", (left ?? []).length === 0);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
