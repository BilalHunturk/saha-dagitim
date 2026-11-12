// Adds three sample zones in central Ankara through save_zone, signed in as the local admin
// (LOCAL_ADMIN_PHONE / LOCAL_ADMIN_PASSWORD in .env.local). Zones that already exist by name
// are skipped, so it is safe to run again.
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/e2e/seed-sample-zones.mjs

import { createClient } from "@supabase/supabase-js";
import { normalizePhone, phoneToEmail } from "../../lib/phone.ts";
import { assertLocalSupabase } from "./local-guard.mjs";

process.loadEnvFile(".env.local");
assertLocalSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL);

const SAMPLE_ZONES = [
  {
    name: "Kızılay",
    color: "#e11d48",
    coordinates: [
      [32.8478, 39.9248],
      [32.8592, 39.9252],
      [32.8611, 39.9196],
      [32.8571, 39.9152],
      [32.8482, 39.9158],
      [32.8478, 39.9248],
    ],
  },
  {
    name: "Çankaya Merkez",
    color: "#2563eb",
    coordinates: [
      [32.8551, 39.9089],
      [32.8702, 39.9093],
      [32.8718, 39.8992],
      [32.8603, 39.8958],
      [32.8538, 39.9011],
      [32.8551, 39.9089],
    ],
  },
  {
    name: "Bahçelievler",
    color: "#16a34a",
    coordinates: [
      [32.8148, 39.9281],
      [32.8317, 39.9286],
      [32.8329, 39.9204],
      [32.8251, 39.9168],
      [32.8152, 39.9179],
      [32.8148, 39.9281],
    ],
  },
];

const phone = normalizePhone(process.env.LOCAL_ADMIN_PHONE ?? "");
if (!phone) throw new Error("LOCAL_ADMIN_PHONE missing or invalid in .env.local");

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { error: signInError } = await supabase.auth.signInWithPassword({
  email: phoneToEmail(phone),
  password: process.env.LOCAL_ADMIN_PASSWORD ?? "",
});
if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);

const { data: existing, error: listError } = await supabase.from("zones_geojson").select("name");
if (listError) throw listError;
const names = new Set(existing.map((z) => z.name));

for (const zone of SAMPLE_ZONES) {
  if (names.has(zone.name)) {
    console.log(`skip  ${zone.name} (exists)`);
    continue;
  }
  const { error } = await supabase.rpc("save_zone", {
    p_id: null,
    p_name: zone.name,
    p_color: zone.color,
    p_note: "Örnek bölge",
    p_geojson: { type: "Polygon", coordinates: [zone.coordinates] },
  });
  if (error) throw new Error(`${zone.name}: ${error.message}`);
  console.log(`added ${zone.name}`);
}

await supabase.auth.signOut();
