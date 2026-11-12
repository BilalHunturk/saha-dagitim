// Browser check of drag-and-drop assignment on /yonetim (Task 6).
//
// Needs: local Supabase running, `next dev` on BASE_URL (default http://localhost:3100), the
// local admin (LOCAL_ADMIN_PHONE / LOCAL_ADMIN_PASSWORD in .env.local), Google Chrome, and the
// three sample zones (tests/e2e/seed-sample-zones.mjs).
// Run: node tests/e2e/assignments.mjs [screenshotDir]
//
// Sample workers (phones +90501000000x) are created through the app's own "Kişiler" page if they
// are missing; their generated passwords are never read. The script ends their active assignments
// at the start (rows are ended, not deleted, so history stays) and leaves a few assignments behind
// for later tasks. A temporary "E2E Geçici" zone is used for the rollback check and hard-deleted.

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

export const SAMPLE_WORKERS = [
  ["Ayşe Yılmaz", "0501 000 00 01"],
  ["Mehmet Kaya", "0501 000 00 02"],
  ["Fatma Demir", "0501 000 00 03"],
  ["Mustafa Çelik", "0501 000 00 04"],
  ["Zeynep Şahin", "0501 000 00 05"],
  ["Emre Öztürk", "0501 000 00 06"],
  ["Elif Arslan", "0501 000 00 07"],
  ["Hüseyin Doğan", "0501 000 00 08"],
];
const e164 = (local) => `+90${local.replace(/\D/g, "").slice(1)}`;
const TEMP_ZONE = "E2E Geçici";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function cleanupTempZone() {
  const { data } = await service.from("zones").select("id").eq("name", TEMP_ZONE);
  const ids = (data ?? []).map((z) => z.id);
  if (ids.length) {
    await service.from("assignments").delete().in("zone_id", ids);
    await service.from("zones").delete().in("id", ids);
  }
}

async function activeZonesOf(workerId) {
  const { data, error } = await service
    .from("assignments")
    .select("zone_id")
    .eq("worker_id", workerId)
    .is("ended_at", null);
  if (error) throw error;
  return data.map((r) => r.zone_id).sort();
}

const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? "chrome",
  headless: process.env.HEADED ? false : true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`console.${m.type()}:`, m.text().slice(0, 300));
});

async function waitMapIdle() {
  await page.waitForFunction(() => window.__sahaMap && window.__sahaMap.loaded(), null, { timeout: 30000 });
  await page.evaluate(() => new Promise((r) => (window.__sahaMap.loaded() ? r() : window.__sahaMap.once("idle", r))));
}

async function gotoBoard() {
  await page.goto(`${BASE}/yonetim`);
  await page.getByRole("button", { name: "Yeni bölge" }).waitFor();
  await waitMapIdle();
}

const card = (zoneId) => page.locator(`[data-zone-id="${zoneId}"]`);
const chip = (zoneId, workerId) => page.locator(`[data-zone-id="${zoneId}"] [data-chip-worker="${workerId}"]`);
const row = (workerId) => page.locator(`[data-person-id="${workerId}"]`);

async function center(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * A plain mouse drag: press and move straight away, in steps, then release. No pause after the
 * press: a mouse drag must start on movement alone (the 150 ms hold is for touch only).
 */
async function drag(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const STEPS = 15;
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / STEPS, from.y + ((to.y - from.y) * i) / STEPS);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Page position of a [lng, lat] on the map. */
async function mapPoint(lngLat) {
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  const p = await page.evaluate((ll) => window.__sahaMap.project(ll), lngLat);
  return { x: box.x + p.x, y: box.y + p.y };
}

/** Rendered features on the terra-draw layers (everything that is not a basemap or zone layer). */
const renderedDraw = () =>
  page.evaluate(() => {
    const m = window.__sahaMap;
    const layers = m.getStyle().layers.map((l) => l.id).filter((id) => !id.startsWith("basemap-") && !id.startsWith("zones-"));
    return layers.length ? m.queryRenderedFeatures({ layers }).length : 0;
  });

/** Aborts (like a dropped connection) every server-action POST while `on`. */
const isAction = (route) => route.request().method() === "POST" && !!route.request().headers()["next-action"];
const abortActions = (route) => (isAction(route) ? route.abort("failed") : route.fallback());
const boardUrl = (url) => url.pathname === "/yonetim"; // one function, so unroute matches it
async function failActions(on) {
  if (on) await page.route(boardUrl, abortActions);
  else await page.unroute(boardUrl, abortActions);
}

const centroid = (polygon) => {
  const ring = polygon.coordinates[0].slice(0, -1);
  return [ring.reduce((s, c) => s + c[0], 0) / ring.length, ring.reduce((s, c) => s + c[1], 0) / ring.length];
};

try {
  await cleanupTempZone();

  // --- Sign in ------------------------------------------------------------------------------
  await page.goto(`${BASE}/giris`);
  await page.locator('input[name="phone"]').fill(process.env.LOCAL_ADMIN_PHONE);
  await page.locator('input[name="password"]').fill(process.env.LOCAL_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(`${BASE}/yonetim`, { timeout: 20000 });

  // --- Sample workers through the Kişiler page (only the missing ones) -----------------------
  const phones = SAMPLE_WORKERS.map(([, p]) => e164(p));
  let { data: existing } = await service.from("profiles").select("id, phone").in("phone", phones);
  const have = new Set(existing.map((w) => w.phone));
  for (const [name, phone] of SAMPLE_WORKERS) {
    if (have.has(e164(phone))) continue;
    await page.goto(`${BASE}/yonetim/kisiler`);
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Kişi ekle" }) });
    await form.locator('input[name="fullName"]').fill(name);
    await form.locator('input[name="phone"]').fill(phone);
    await form.getByRole("button", { name: "Ekle" }).click();
    await page.getByTestId("generated-password").waitFor({ timeout: 15000 }); // shown, never read
  }
  ({ data: existing } = await service
    .from("profiles")
    .select("id, phone, full_name, active")
    .in("phone", phones));
  check("8 sample workers exist and are active", existing.length === 8 && existing.every((w) => w.active));
  const W = Object.fromEntries(existing.map((w) => [w.full_name, w.id]));
  const ayse = W["Ayşe Yılmaz"];
  const mehmet = W["Mehmet Kaya"];
  const fatma = W["Fatma Demir"];
  const zeynep = W["Zeynep Şahin"];

  // Known starting point: end (not delete) the sample workers' active assignments.
  await service.from("assignments").update({ ended_at: new Date().toISOString() }).in("worker_id", Object.values(W)).is("ended_at", null);

  const { data: zones } = await service.from("zones_geojson").select("id, name, geojson").order("name");
  const Z = Object.fromEntries(zones.map((z) => [z.name, z]));
  const kizilay = Z["Kızılay"].id;
  const cankaya = Z["Çankaya Merkez"].id;
  const bahce = Z["Bahçelievler"].id;

  await gotoBoard();
  await page.screenshot({ path: join(SHOTS, "a01-board.png") });
  check(
    "people panel lists active workers, all 'Atanmadı'",
    (await row(ayse).count()) === 1 && (await row(ayse).textContent()).includes("Atanmadı"),
  );

  // --- 1. Unassigned person → card --------------------------------------------------------------
  await drag(await center(row(ayse)), await center(card(kizilay)));
  await chip(kizilay, ayse).waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check(
    "drop person on card: chip + badge",
    (await chip(kizilay, ayse).textContent()) === "Ayşe Yılmaz" &&
      (await row(ayse).locator("[data-badge-count]").textContent()) === "1" &&
      (await card(kizilay).textContent()).includes("1 kişi"),
  );
  check("assignment stored", JSON.stringify(await activeZonesOf(ayse)) === JSON.stringify([kizilay]));

  // --- 2. Same person → second zone: dialog, "Buraya da ekle" ----------------------------------
  await drag(await center(row(ayse)), await center(card(cankaya)));
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 5000 });
  const dialogText = await dialog.textContent();
  check("dialog asks Ekle/Taşı", dialogText.includes("Ayşe Yılmaz şu bölgelerde görevli: Kızılay."), dialogText);
  await page.screenshot({ path: join(SHOTS, "a02-ask-dialog.png") });
  await dialog.getByRole("button", { name: "Buraya da ekle" }).click();
  await chip(cankaya, ayse).waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check(
    "'Buraya da ekle' → in both zones, badge 2",
    (await chip(kizilay, ayse).count()) === 1 &&
      (await row(ayse).locator("[data-badge-count]").textContent()) === "2" &&
      JSON.stringify(await activeZonesOf(ayse)) === JSON.stringify([kizilay, cankaya].sort()),
  );

  // --- 3. Chip → another card: move, history kept ------------------------------------------------
  const chipHandle = chip(cankaya, ayse).locator("span").first();
  await drag(await center(chipHandle), await center(card(bahce)));
  await chip(bahce, ayse).waitFor({ timeout: 10000 });
  await chip(cankaya, ayse).waitFor({ state: "detached", timeout: 10000 });
  await page.waitForTimeout(800);
  const { data: hist } = await service
    .from("assignments")
    .select("ended_at")
    .eq("worker_id", ayse)
    .eq("zone_id", cankaya)
    .not("ended_at", "is", null)
    .gte("started_at", new Date(Date.now() - 5 * 60_000).toISOString());
  check(
    "chip dragged to another card → moved, ended history row kept",
    JSON.stringify(await activeZonesOf(ayse)) === JSON.stringify([kizilay, bahce].sort()) && hist.length >= 1,
  );
  await page.screenshot({ path: join(SHOTS, "a03-moved.png") });

  // --- 3b. "Taşı" with a single current zone moves directly ---------------------------------------
  await drag(await center(row(fatma)), await center(card(cankaya)));
  await chip(cankaya, fatma).waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  await drag(await center(row(fatma)), await center(card(bahce)));
  await page.getByRole("dialog").getByRole("button", { name: "Taşı" }).click();
  await chip(bahce, fatma).waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check("'Taşı' with one current zone moves directly", JSON.stringify(await activeZonesOf(fatma)) === JSON.stringify([bahce]));

  // --- 4. Drop on a map polygon ----------------------------------------------------------------
  const kc = centroid(Z["Kızılay"].geojson);
  await page.evaluate((c) => window.__sahaMap.jumpTo({ center: c, zoom: 14 }), kc);
  await waitMapIdle();
  await drag(await center(row(mehmet)), await mapPoint(kc));
  await chip(kizilay, mehmet).waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check("drop on map polygon → assigned", JSON.stringify(await activeZonesOf(mehmet)) === JSON.stringify([kizilay]));

  // Map panning still works when nothing is dragged.
  const c0 = await page.evaluate(() => window.__sahaMap.getCenter().toArray());
  const mp = await mapPoint(kc);
  await page.mouse.move(mp.x, mp.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(mp.x + i * 15, mp.y + i * 5);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const c1 = await page.evaluate(() => window.__sahaMap.getCenter().toArray());
  check("map still pans with a plain mouse drag", Math.abs(c1[0] - c0[0]) > 1e-4, `${c0} -> ${c1}`);

  // --- 4b. While drawing a zone, drops on the map are ignored --------------------------------------
  await page.evaluate((c) => window.__sahaMap.jumpTo({ center: c, zoom: 14 }), kc);
  await waitMapIdle();
  await page.getByRole("button", { name: "Yeni bölge" }).click();
  await page.getByText("Haritaya tıklayarak köşeleri ekleyin").waitFor();
  const target = await mapPoint(kc);
  const from = await center(row(zeynep));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(from.x + ((target.x - from.x) * i) / 15, from.y + ((target.y - from.y) * i) / 15);
    await page.waitForTimeout(16);
  }
  const hint = await page.getByText("Bölge düzenlenirken haritaya bırakılamaz").isVisible();
  await page.mouse.up();
  await page.waitForTimeout(1000);
  const drawFeatures = await page.evaluate(() => {
    const m = window.__sahaMap;
    const layers = m.getStyle().layers.map((l) => l.id).filter((id) => !id.startsWith("basemap-") && !id.startsWith("zones-"));
    return layers.length ? m.queryRenderedFeatures({ layers }).length : 0;
  });
  check(
    "while drawing: map drop is disabled (hint shown, no assignment, no stray vertex)",
    hint && (await activeZonesOf(zeynep)).length === 0 && drawFeatures === 0,
    `hint=${hint} drawFeatures=${drawFeatures}`,
  );
  await page.getByRole("button", { name: "Vazgeç" }).click();

  // --- 5. × removes ----------------------------------------------------------------------------------
  await chip(kizilay, mehmet).getByRole("button", { name: "Mehmet Kaya atamasını kaldır" }).click();
  await chip(kizilay, mehmet).waitFor({ state: "detached", timeout: 10000 });
  await page.waitForTimeout(800);
  check(
    "× removes the assignment",
    (await activeZonesOf(mehmet)).length === 0 && (await row(mehmet).textContent()).includes("Atanmadı"),
  );

  // --- 6. Search and filters --------------------------------------------------------------------------
  const listRows = page.locator('[aria-label="Kişi listesi"] [data-person-id]');
  const search = page.getByLabel("Kişi ara");
  await search.fill("ayşe");
  await page.waitForTimeout(300);
  const byName = await listRows.count();
  await search.fill("0501 000 00 04");
  await page.waitForTimeout(300);
  const byPhone = await listRows.allTextContents();
  await search.fill("");
  await page.waitForTimeout(300);
  check("search by name (Turkish case) and by phone", byName === 1 && byPhone.length === 1 && byPhone[0].includes("Mustafa Çelik"), `${byName} / ${byPhone}`);

  const { count: workerCount } = await service.from("profiles").select("id", { count: "exact", head: true }).eq("role", "worker").eq("active", true);
  const filter = (name) => page.getByRole("radio", { name: new RegExp(`^${name}`) });
  await filter("Atanmış").click();
  await page.waitForTimeout(300);
  const assignedRows = await listRows.evaluateAll((els) => els.map((e) => e.getAttribute("data-person-id")));
  await filter("Atanmamış").click();
  await page.waitForTimeout(300);
  const unassignedRows = await listRows.evaluateAll((els) => els.map((e) => e.getAttribute("data-person-id")));
  await filter("Tümü").click();
  await page.waitForTimeout(300);
  const allRows = await listRows.count();
  check(
    "filters Tümü / Atanmamış / Atanmış",
    allRows === workerCount &&
      assignedRows.includes(ayse) && assignedRows.includes(fatma) && !assignedRows.includes(mehmet) &&
      unassignedRows.includes(mehmet) && !unassignedRows.includes(ayse) &&
      assignedRows.length + unassignedRows.length === allRows,
    `all=${allRows} assigned=${assignedRows.length} unassigned=${unassignedRows.length}`,
  );

  // --- 7. A failing action rolls back the optimistic update --------------------------------------------
  // The zone is archived behind the page's back, so the server rejects the assignment.
  const { data: tmp, error: tErr } = await service
    .from("zones")
    .insert({
      name: TEMP_ZONE,
      color: "#7c3aed",
      geom: "SRID=4326;POLYGON((32.80 39.90,32.81 39.90,32.81 39.91,32.80 39.91,32.80 39.90))",
    })
    .select("id")
    .single();
  if (tErr) throw tErr;
  await gotoBoard();
  await service.from("zones").update({ archived_at: new Date().toISOString() }).eq("id", tmp.id);
  await card(tmp.id).scrollIntoViewIfNeeded();
  // Record whether the chip ever appears (the optimistic update), however briefly.
  await page.evaluate((sel) => {
    window.__sawChip = false;
    const obs = new MutationObserver(() => {
      if (document.querySelector(sel)) window.__sawChip = true;
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__chipObs = obs;
  }, `[data-zone-id="${tmp.id}"] [data-chip-worker="${mehmet}"]`);
  await drag(await center(row(mehmet)), await center(card(tmp.id)));
  const alert = page.locator("[role=alert]", { hasText: "Bölge bulunamadı ya da arşivlenmiş" });
  await alert.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, "a04-rollback.png") });
  const sawOptimistic = await page.evaluate(() => (window.__chipObs.disconnect(), window.__sawChip));
  check(
    "failed action: optimistic chip shown, then rolled back, error strip shown",
    sawOptimistic &&
      (await chip(tmp.id, mehmet).count()) === 0 &&
      (await activeZonesOf(mehmet)).length === 0 &&
      (await row(mehmet).textContent()).includes("Atanmadı"),
    `optimistic chip seen=${sawOptimistic}`,
  );
  await cleanupTempZone();

  // --- 7b. A failed action request (network drop) during an in-progress drawing ---------------------
  // The board must stay (no error page), the strip must say so, the optimistic chip must roll back,
  // and the half-drawn zone must still be on the map.
  await gotoBoard();
  await page.evaluate((c) => window.__sahaMap.jumpTo({ center: c, zoom: 14 }), kc);
  await waitMapIdle();
  await page.getByRole("button", { name: "Yeni bölge" }).click();
  await page.getByText("Haritaya tıklayarak köşeleri ekleyin").waitFor();
  const cv = await page.locator(".maplibregl-canvas").boundingBox();
  for (const [dx, dy] of [[-80, -60], [80, -60], [80, 60]]) {
    const x = cv.x + cv.width / 2 + dx;
    const y = cv.y + cv.height / 2 + dy;
    await page.mouse.move(x, y);
    await page.waitForTimeout(80);
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  }
  const drawnBefore = await renderedDraw();
  await failActions(true);
  await row(mehmet).locator("button").click();
  await page.getByRole("dialog", { name: "Bölgeye ata" }).getByRole("button", { name: /Kızılay/ }).click();
  const netStrip = page.locator("[role=alert]", { hasText: "Bağlantı sorunu. Lütfen tekrar deneyin." });
  await netStrip.waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, "a04b-network-error.png") });
  const drawnAfter = await renderedDraw();
  check(
    "failed action request: board stays, error strip shown, rolled back, drawing kept",
    (await page.getByRole("complementary", { name: "Bölgeler paneli" }).isVisible()) &&
      (await page.getByText("Haritaya tıklayarak köşeleri ekleyin").isVisible()) &&
      drawnBefore > 0 && drawnAfter === drawnBefore &&
      (await chip(kizilay, mehmet).count()) === 0 &&
      (await row(mehmet).textContent()).includes("Atanmadı") &&
      (await activeZonesOf(mehmet)).length === 0,
    `drawn ${drawnBefore} -> ${drawnAfter}`,
  );
  await failActions(false);
  // The drawing can still be finished after the failure.
  {
    const x = cv.x + cv.width / 2 - 80;
    const y = cv.y + cv.height / 2 + 60;
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
    await page.mouse.click(cv.x + cv.width / 2 - 80, cv.y + cv.height / 2 - 60);
    await page.waitForTimeout(250);
  }
  check("drawing can be finished after the failed request", await page.getByLabel("Bölge adı").isVisible());
  await page.getByRole("button", { name: "Vazgeç" }).click();

  // --- 7c. Collapsible people column (lg+) ---------------------------------------------------------
  const peopleAside = page.getByRole("complementary", { name: "Kişiler paneli" });
  const hideBtn = page.getByRole("button", { name: "Kişiler sütununu gizle" });
  const showBtn = page.getByRole("button", { name: "Kişiler sütununu göster" });
  const canvasW = async () => (await page.locator(".maplibregl-canvas").boundingBox()).width;
  await page.evaluate(() => localStorage.removeItem("saha.peopleColumn"));
  await gotoBoard();
  const wOpen = await canvasW();
  check("1280px: people column open by default", (await peopleAside.isVisible()) && !(await showBtn.isVisible()));
  await hideBtn.click();
  await page.waitForTimeout(500);
  const wClosed = await canvasW();
  check(
    "hiding the people column widens the map",
    !(await peopleAside.isVisible()) && (await showBtn.isVisible()) && wClosed >= wOpen + 290,
    `${Math.round(wOpen)} -> ${Math.round(wClosed)}`,
  );
  await gotoBoard();
  check("collapsed state is remembered after reload", !(await peopleAside.isVisible()) && (await showBtn.isVisible()));
  await showBtn.click();
  await row(ayse).waitFor({ state: "visible" });
  check("reopening shows the people column again", await peopleAside.isVisible());

  await page.evaluate(() => localStorage.removeItem("saha.peopleColumn"));
  await page.setViewportSize({ width: 1100, height: 800 });
  await gotoBoard();
  const w1100 = await canvasW();
  await page.screenshot({ path: join(SHOTS, "a07-1100-collapsed.png") });
  check(
    "1100px: people column collapsed by default, map gets the room",
    !(await peopleAside.isVisible()) && (await showBtn.isVisible()) && w1100 >= 1100 - 360 - 2,
    `map w=${Math.round(w1100)}`,
  );
  await showBtn.click();
  await row(zeynep).locator("button").click();
  const picker1100 = page.getByRole("dialog", { name: "Bölgeye ata" });
  await picker1100.waitFor({ timeout: 5000 });
  check("1100px: after reopening, the 'Bölgeye ata' picker is reachable", await picker1100.isVisible());
  await page.screenshot({ path: join(SHOTS, "a08-1100-open.png") });
  await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.removeItem("saha.peopleColumn"));
  await page.setViewportSize({ width: 1280, height: 800 });

  // --- 8. Phone (375px): tabs + "Bölgeye ata" picker ------------------------------------------------------
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoBoard();
  await page.getByRole("button", { name: /^Kişiler/ }).click();
  await row(zeynep).waitFor();
  check(
    "375px: Kişiler tab shows the people list, zone list hidden",
    (await row(zeynep).isVisible()) && !(await card(kizilay).isVisible()),
  );
  await row(zeynep).locator("button").click();
  const picker = page.getByRole("dialog", { name: "Bölgeye ata" });
  await picker.waitFor();
  await page.screenshot({ path: join(SHOTS, "a05-picker-375.png") });
  await picker.getByRole("button", { name: /Çankaya Merkez/ }).click();
  await page.waitForTimeout(1500);
  check("375px picker assigns", JSON.stringify(await activeZonesOf(zeynep)) === JSON.stringify([cankaya]));
  // Same rules as a drop: picking another zone for an assigned worker asks Ekle/Taşı.
  await row(ayse).locator("button").click();
  await page.getByRole("dialog", { name: "Bölgeye ata" }).getByRole("button", { name: /Çankaya Merkez/ }).click();
  const ask = page.getByRole("dialog", { name: /Çankaya Merkez bölgesine ata/ });
  await ask.waitFor({ timeout: 5000 });
  await ask.getByRole("button", { name: "Buraya da ekle" }).click();
  await page.waitForTimeout(1500);
  check("375px picker uses the same Ekle/Taşı rules", (await activeZonesOf(ayse)).length === 3);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check("375px: no horizontal scroll", scrollW <= 375, `scrollW=${scrollW}`);

  // Drag from the people tab onto the map polygon still works on a phone-size screen.
  await page.evaluate((c) => window.__sahaMap.jumpTo({ center: c, zoom: 14 }), kc);
  await waitMapIdle();
  await drag(await center(row(mehmet)), await mapPoint(kc));
  await page.waitForTimeout(1500);
  check("375px: drag person onto map polygon", JSON.stringify(await activeZonesOf(mehmet)) === JSON.stringify([kizilay]));
  await page.screenshot({ path: join(SHOTS, "a06-375-after.png") });
} catch (e) {
  check("unexpected error", false, e.message);
  await page.screenshot({ path: join(SHOTS, "a-error.png") }).catch(() => {});
} finally {
  await page.evaluate(() => localStorage.removeItem("saha.peopleColumn")).catch(() => {});
  await browser.close();
  await cleanupTempZone();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
