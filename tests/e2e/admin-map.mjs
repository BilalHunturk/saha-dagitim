// Browser check of the admin map (/yonetim): draw, persist, edit a vertex, switch basemap,
// self-intersecting polygon error, archive, and layout at 1280px / 375px.
//
// Needs: local Supabase running, `next dev` on BASE_URL (default http://localhost:3100), the
// local admin (LOCAL_ADMIN_PHONE / LOCAL_ADMIN_PASSWORD in .env.local) and Google Chrome.
// Run: node tests/e2e/admin-map.mjs [screenshotDir]
// Zones it creates are named "E2E …" and hard-deleted with the service role at the end.

import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

process.loadEnvFile(".env.local");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
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

async function e2eZones() {
  const { data, error } = await service
    .from("zones")
    .select("id, name, archived_at, geom")
    .like("name", "E2E %");
  if (error) throw error;
  return data;
}

// A temporary worker, so assignment chips and the archive warning can be checked.
const WORKER_PHONE = "+905009999901";
const WORKER_NAME = "E2E Dağıtıcı";

async function createWorker() {
  const { data, error } = await service.auth.admin.createUser({
    email: `${WORKER_PHONE.slice(1)}@saha.local`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  const { error: pErr } = await service
    .from("profiles")
    .insert({ id: data.user.id, full_name: WORKER_NAME, phone: WORKER_PHONE, role: "worker" });
  if (pErr) throw pErr;
  return data.user.id;
}

async function cleanup() {
  const zones = await e2eZones();
  const ids = zones.map((z) => z.id);
  if (ids.length) {
    await service.from("assignments").delete().in("zone_id", ids);
    const { error } = await service.from("zones").delete().in("id", ids);
    if (error) throw error;
  }
  const { data: workers } = await service.from("profiles").select("id").eq("phone", WORKER_PHONE);
  for (const w of workers ?? []) {
    await service.from("assignments").delete().eq("worker_id", w.id);
    await service.auth.admin.deleteUser(w.id); // cascades to the profile
  }
}

const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? "chrome",
  headless: process.env.HEADED ? false : true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

/** Rendered feature count on the given map layers. */
const rendered = (layers) =>
  page.evaluate((layers) => {
    const map = window.__sahaMap;
    const existing = layers.filter((l) => map.getLayer(l));
    return existing.length ? map.queryRenderedFeatures({ layers: existing }).length : 0;
  }, layers);

/** Ids of the terra-draw layers currently on the map. */
const drawLayers = () =>
  page.evaluate(() =>
    window.__sahaMap
      .getStyle()
      .layers.map((l) => l.id)
      .filter((id) => !id.startsWith("basemap-") && !id.startsWith("zones-")),
  );

/** Page coordinates of a [lng, lat] on the map canvas. */
async function toPage(lngLat) {
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  const p = await page.evaluate((ll) => window.__sahaMap.project(ll), lngLat);
  return { x: box.x + p.x, y: box.y + p.y };
}

async function clickMap(lngLat) {
  const { x, y } = await toPage(lngLat);
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.click(x, y);
  await page.waitForTimeout(250);
}

async function waitMapIdle() {
  await page.waitForFunction(() => window.__sahaMap && window.__sahaMap.loaded(), null, { timeout: 30000 });
  await page.evaluate(() => new Promise((r) => (window.__sahaMap.loaded() ? r() : window.__sahaMap.once("idle", r))));
}

async function gotoBoard() {
  await page.goto(`${BASE}/yonetim`);
  await page.getByRole("button", { name: "Yeni bölge" }).waitFor();
  await page.waitForFunction(() => !!window.__sahaMap);
  await waitMapIdle();
  // Fixed view so pixel positions are predictable.
  await page.evaluate(() => window.__sahaMap.jumpTo({ center: [32.86, 39.93], zoom: 14 }));
  await waitMapIdle();
}

// A square and a bow tie near Kocatepe, away from the sample zones.
const SQUARE = [
  [32.852, 39.936],
  [32.862, 39.936],
  [32.862, 39.929],
  [32.852, 39.929],
];
const BOWTIE = [
  [32.852, 39.936],
  [32.862, 39.929],
  [32.862, 39.936],
  [32.852, 39.929],
];

async function drawPolygon(points) {
  await page.getByRole("button", { name: "Yeni bölge" }).click();
  await page.getByText("Haritaya tıklayarak köşeleri ekleyin").waitFor();
  for (const p of points) await clickMap(p);
  await clickMap(points[0]); // close on the first point
  await page.getByLabel("Bölge adı").waitFor({ timeout: 5000 });
}

try {
  await cleanup();

  // --- Sign in ---------------------------------------------------------------------------
  await page.goto(`${BASE}/giris`);
  await page.locator('input[name="phone"]').fill(process.env.LOCAL_ADMIN_PHONE);
  await page.locator('input[name="password"]').fill(process.env.LOCAL_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(`${BASE}/yonetim`, { timeout: 20000 });
  check("admin signs in and lands on /yonetim", true);

  await gotoBoard();
  const initialZones = await page.locator("[data-zone-id]").count();
  await page.screenshot({ path: join(SHOTS, "01-board-1280.png") });

  // --- Draw and save ---------------------------------------------------------------------
  await drawPolygon(SQUARE);
  check("drawing finishes and shows the form", true);
  await page.getByLabel("Bölge adı").fill("E2E Kare");
  await page.getByRole("radio", { name: "Renk #16a34a" }).click();
  await page.getByLabel("Not").fill("deneme notu");
  await page.screenshot({ path: join(SHOTS, "02-form.png") });
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.locator("[data-zone-id]", { hasText: "E2E Kare" }).waitFor({ timeout: 15000 });
  let rows = await e2eZones();
  check("saved zone is in the database", rows.length === 1 && rows[0].name === "E2E Kare");
  const zoneId = rows[0]?.id;

  await page.reload();
  await gotoBoard();
  check(
    "zone persists after reload",
    (await page.locator(`[data-zone-id="${zoneId}"]`).count()) === 1 &&
      (await page.locator("[data-zone-id]").count()) === initialZones + 1,
  );
  check("zone polygon is rendered (zones-fill)", (await rendered(["zones-fill"])) > 0);

  // --- Basemap switch keeps polygons -------------------------------------------------------
  const before = await rendered(["zones-fill", "zones-line"]);
  await page.getByRole("radio", { name: "Sokak" }).click();
  await waitMapIdle();
  const visStreets = await page.evaluate(() => [
    window.__sahaMap.getLayoutProperty("basemap-streets", "visibility"),
    window.__sahaMap.getLayoutProperty("basemap-satellite", "visibility"),
  ]);
  const after = await rendered(["zones-fill", "zones-line"]);
  check("switch to Sokak shows streets basemap", visStreets[0] === "visible" && visStreets[1] === "none");
  check("zone polygons survive basemap switch", before > 0 && after === before, `${before} -> ${after}`);
  await page.screenshot({ path: join(SHOTS, "03-streets.png") });
  await page.reload();
  await gotoBoard();
  check(
    "basemap choice persists (localStorage)",
    (await page.getByRole("radio", { name: "Sokak" }).getAttribute("aria-checked")) === "true",
  );

  // --- In-progress drawing survives basemap switch -----------------------------------------
  await page.getByRole("button", { name: "Yeni bölge" }).click();
  const partial = [
    [32.866, 39.936],
    [32.874, 39.936],
    [32.874, 39.93],
  ];
  for (const p of partial) await clickMap(p);
  const drawBefore = await rendered(await drawLayers());
  await page.getByRole("radio", { name: "Uydu" }).click();
  await waitMapIdle();
  const drawAfter = await rendered(await drawLayers());
  check("in-progress drawing survives basemap switch", drawBefore > 0 && drawAfter === drawBefore, `${drawBefore} -> ${drawAfter}`);
  await clickMap([32.866, 39.93]);
  await clickMap(partial[0]);
  check("drawing can still be finished after the switch", await page.getByLabel("Bölge adı").isVisible());
  await page.getByRole("button", { name: "Vazgeç" }).click();
  check("Vazgeç discards the drawing", (await rendered(await drawLayers())) === 0 && (await e2eZones()).length === 1);

  // --- Edit: drag a vertex and save ---------------------------------------------------------
  await page.locator(`[data-zone-id="${zoneId}"] button`).first().click();
  await page.getByText("Bölgeyi düzenle").waitFor();
  await page.waitForTimeout(800); // fitBounds animation
  await waitMapIdle();
  const from = await toPage(SQUARE[1]);
  const target = [32.86, 39.934]; // pull the NE corner inwards (stays inside the fitted view)
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  const to = await toPage(target);
  const STEPS = 30;
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / STEPS, from.y + ((to.y - from.y) * i) / STEPS);
    await page.waitForTimeout(20);
  }
  // terra-draw's select mode skips every 5th drag event; a couple of extra moves at the
  // release point make sure the last position is applied, as a real hand does.
  await page.mouse.move(to.x + 1, to.y);
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, "04-vertex-dragged.png") });
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText("Bölgeyi düzenle").waitFor({ state: "detached", timeout: 15000 });
  const { data: geo } = await service.from("zones_geojson").select("geojson").eq("id", zoneId).single();
  const ring = geo.geojson.coordinates[0];
  const moved = ring.some(([lng, lat]) => Math.abs(lng - target[0]) < 0.0005 && Math.abs(lat - target[1]) < 0.0005);
  const gone = !ring.some(([lng, lat]) => Math.abs(lng - SQUARE[1][0]) < 1e-6 && Math.abs(lat - SQUARE[1][1]) < 1e-6);
  check("dragged vertex is saved", moved && gone, JSON.stringify(ring.map((c) => c.map((n) => +n.toFixed(4)))));

  // --- Self-intersecting polygon: server error, drawing stays --------------------------------
  await drawPolygon(BOWTIE);
  await page.getByLabel("Bölge adı").fill("E2E Papyon");
  const bowtieRendered = await rendered(await drawLayers());
  await page.getByRole("button", { name: "Kaydet" }).click();
  // Scoped to the editor: Next.js also renders a role="alert" route announcer.
  const alert = page.locator("section[aria-label] [role=alert]");
  await alert.waitFor({ timeout: 15000 });
  const alertText = (await alert.textContent())?.trim();
  check("bow tie shows the server's Turkish error", alertText === "Geçersiz bölge şekli", alertText);
  check(
    "bow tie drawing stays on screen with the form",
    (await rendered(await drawLayers())) === bowtieRendered && bowtieRendered > 0 &&
      (await page.getByLabel("Bölge adı").inputValue()) === "E2E Papyon",
  );
  await page.screenshot({ path: join(SHOTS, "05-bowtie-error.png") });
  check("bow tie was not stored", (await e2eZones()).every((z) => z.name !== "E2E Papyon"));
  await page.getByRole("button", { name: "Vazgeç" }).click();

  // --- Assignment chips (read-only) -------------------------------------------------------------
  const workerId = await createWorker();
  const { data: admin } = await service.from("profiles").select("id").eq("role", "admin").limit(1).single();
  const { error: aErr } = await service
    .from("assignments")
    .insert({ zone_id: zoneId, worker_id: workerId, assigned_by: admin.id });
  if (aErr) throw aErr;
  await gotoBoard();
  const chips = await page.locator(`[data-zone-id="${zoneId}"] [aria-label="Atanan kişiler"] li`).allTextContents();
  check("zone card shows assigned worker chips", chips.length === 1 && chips[0] === WORKER_NAME, chips.join(","));

  // --- Map click selects a zone, then archive -------------------------------------------------
  await clickMap([32.855, 39.932]);
  await page.getByText("Bölgeyi düzenle").waitFor({ timeout: 5000 });
  check("clicking the polygon on the map opens it for editing", (await page.getByLabel("Bölge adı").inputValue()) === "E2E Kare");
  await page.getByRole("button", { name: "Arşivle" }).click();
  const confirmText = await page.getByRole("alertdialog").textContent();
  check(
    "archive asks for confirmation with the assignment count",
    /arşivlenecek/.test(confirmText ?? "") && /1 kişinin ataması kaldırılacak/.test(confirmText ?? ""),
    confirmText?.trim(),
  );
  await page.getByRole("button", { name: "Evet, arşivle" }).click();
  await page.getByText("Bölgeyi düzenle").waitFor({ state: "detached", timeout: 15000 });
  await page.locator(`[data-zone-id="${zoneId}"]`).waitFor({ state: "detached", timeout: 15000 });
  rows = await e2eZones();
  const { data: openAssignments } = await service.from("assignments").select("id").eq("zone_id", zoneId).is("ended_at", null);
  check(
    "archived zone leaves the list, is archived in the DB and its assignments are ended",
    rows.length === 1 && rows[0].archived_at !== null && openAssignments.length === 0,
  );
  await waitMapIdle();
  check(
    "archived zone is not rendered",
    (await page.evaluate(() => window.__sahaMap.querySourceFeatures("zones").map((f) => f.properties.name))).every(
      (n) => n !== "E2E Kare",
    ),
  );

  // --- Layout -----------------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoBoard();
  const aside = await page.getByRole("complementary", { name: "Bölgeler paneli" }).boundingBox();
  check("1280px: 360px side panel on the left", Math.round(aside.width) === 360 && aside.x === 0, JSON.stringify(aside));
  await page.screenshot({ path: join(SHOTS, "06-layout-1280.png") });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  const asideM = await page.getByRole("complementary", { name: "Bölgeler paneli" }).boundingBox();
  const canvasM = await page.locator(".maplibregl-canvas").boundingBox();
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(
    "375px: panel is at the bottom under the map, no horizontal scroll",
    asideM.y > canvasM.y && Math.round(asideM.width) === 375 && canvasM.height > 250 && scrollW <= 375,
    `panel y=${Math.round(asideM.y)} h=${Math.round(asideM.height)}, map h=${Math.round(canvasM.height)}, scrollW=${scrollW}`,
  );
  await page.screenshot({ path: join(SHOTS, "07-layout-375.png") });
  await page.getByRole("button", { name: /Bölgeler/ }).click();
  await page.waitForTimeout(300);
  const canvasCollapsed = await page.locator(".maplibregl-canvas").boundingBox();
  check("375px: collapsing the panel gives the map more room", canvasCollapsed.height > canvasM.height);
  await page.screenshot({ path: join(SHOTS, "08-layout-375-collapsed.png") });
} catch (e) {
  check("unexpected error", false, e.message);
  await page.screenshot({ path: join(SHOTS, "error.png") }).catch(() => {});
} finally {
  await page.evaluate(() => localStorage.removeItem("saha.basemap")).catch(() => {});
  await browser.close();
  await cleanup();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
