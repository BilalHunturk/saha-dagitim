import { LogoutButton } from "@/components/LogoutButton";
import { requireRole } from "@/lib/auth";

export default async function WorkerLayout({ children }: LayoutProps<"/gorevim">) {
  const profile = await requireRole("worker");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2">
        <span className="truncate text-sm font-medium text-zinc-800">{profile.full_name}</span>
        <div className="ml-auto">
          <LogoutButton />
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
