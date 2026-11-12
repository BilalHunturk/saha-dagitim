import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { requireRole } from "@/lib/auth";

export default async function AdminLayout({ children }: LayoutProps<"/yonetim">) {
  const profile = await requireRole("admin");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-4 py-2">
        <nav className="flex items-center gap-1 text-sm font-medium">
          <Link href="/yonetim" className="rounded-lg px-3 py-1.5 text-zinc-800 hover:bg-zinc-100">
            Harita
          </Link>
          <Link
            href="/yonetim/kisiler"
            className="rounded-lg px-3 py-1.5 text-zinc-800 hover:bg-zinc-100"
          >
            Kişiler
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="truncate text-sm text-zinc-600">{profile.full_name}</span>
          <LogoutButton />
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
