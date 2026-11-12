import { redirect } from "next/navigation";
import { getSessionProfile, homeFor } from "@/lib/auth";
import { LOGIN_MESSAGES } from "@/lib/login";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/giris">) {
  const profile = await getSessionProfile();
  if (profile) redirect(homeFor(profile.role));

  const { hata } = await searchParams;
  const initialError = hata === "pasif" ? LOGIN_MESSAGES.INACTIVE : undefined;

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold text-zinc-900">Saha Dağıtım</h1>
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <LoginForm initialError={initialError} />
        </div>
      </div>
    </main>
  );
}
