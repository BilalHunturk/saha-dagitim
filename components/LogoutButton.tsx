import { logout } from "@/app/giris/actions";

export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="min-h-11 rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-100"
      >
        Çıkış
      </button>
    </form>
  );
}
