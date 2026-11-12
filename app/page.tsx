import { redirect } from "next/navigation";
import { getSessionProfile, homeFor } from "@/lib/auth";

export default async function Home() {
  const profile = await getSessionProfile();
  redirect(profile ? homeFor(profile.role) : "/giris");
}
