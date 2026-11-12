"use server";

import { redirect } from "next/navigation";
import { homeFor, loadSessionState } from "@/lib/auth";
import { normalizePhone, phoneToEmail } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

// A "use server" file may export only async functions, so these stay module-private.
const INVALID_PHONE = "Telefon numarası geçersiz";
const WRONG_CREDENTIALS = "Telefon veya şifre hatalı";
const INACTIVE = "Hesabınız pasif. Yöneticinize başvurun.";

export async function login(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) return { error: INVALID_PHONE };

  const password = String(formData.get("password") ?? "");
  if (!password) return { error: WRONG_CREDENTIALS };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToEmail(phone),
    password,
  });
  if (error) return { error: WRONG_CREDENTIALS };

  const state = await loadSessionState(supabase);
  if (state.status !== "ok") {
    await supabase.auth.signOut();
    return { error: state.status === "inactive" ? INACTIVE : WRONG_CREDENTIALS };
  }

  redirect(homeFor(state.profile.role));
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/giris");
}
