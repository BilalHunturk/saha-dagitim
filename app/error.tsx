"use client"; // Error boundaries must be Client Components

/**
 * Shown when a page cannot be rendered, most often because the session or profile could not
 * be checked (lib/auth.ts throws instead of guessing). The session is kept; retry re-renders.
 */
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-zinc-200">
        <p role="alert" className="mb-4 text-base text-zinc-800">
          Bağlantı sorunu. Lütfen tekrar deneyin.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="h-12 w-full rounded-lg bg-blue-600 text-base font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Tekrar dene
        </button>
      </div>
    </main>
  );
}
