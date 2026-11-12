#!/usr/bin/env node
// Creates an admin: auth user (synthetic email from phone) + profiles row with role='admin'.
// Usage: node scripts/create-admin.mjs "<ad soyad>" "<telefon>" "<şifre>"
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local if present).
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone, phoneToEmail } from "../lib/phone.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function fail(message) {
  console.error(`Hata: ${message}`);
  process.exit(1);
}

const [fullNameArg, phoneArg, password] = process.argv.slice(2);
if (!fullNameArg || !phoneArg || !password) {
  fail('Kullanım: node scripts/create-admin.mjs "<ad soyad>" "<telefon>" "<şifre>"');
}

const fullName = fullNameArg.trim();
if (!fullName) fail("Ad soyad gerekli.");
const phone = normalizePhone(phoneArg);
if (!phone) fail("Geçersiz cep telefonu numarası.");
if (password.length < 6) fail("Şifre en az 6 karakter olmalı.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanımlı olmalı.");

// Show where this is going (host only, never keys) before anything is written.
let host;
try {
  host = new URL(url).host;
} catch {
  fail("NEXT_PUBLIC_SUPABASE_URL geçerli bir adres değil.");
}
const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
console.log(`Hedef Supabase: ${host} (${local ? "yerel" : "YEREL DEĞİL, örneğin üretim"})`);

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: existing, error: lookupError } = await supabase.from("profiles").select("id").eq("phone", phone).maybeSingle();
if (lookupError) fail(lookupError.message);
if (existing) fail("Bu telefon numarasıyla kayıtlı bir kişi zaten var.");

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email: phoneToEmail(phone),
  password,
  email_confirm: true,
});
if (createError || !created.user) {
  fail(createError?.code === "email_exists" ? "Bu telefon numarasıyla kayıtlı bir kullanıcı zaten var." : createError?.message);
}

const userId = created.user.id;
const { error: profileError } = await supabase
  .from("profiles")
  .insert({ id: userId, full_name: fullName, phone, role: "admin", active: true });
if (profileError) {
  // Do not leave a half-created auth user behind.
  await supabase.auth.admin.deleteUser(userId);
  fail(`Profil oluşturulamadı: ${profileError.message}`);
}

console.log(`Yönetici oluşturuldu: ${fullName} (${phone}), id ${userId}`);
