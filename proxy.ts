import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/yonetim", "/gorevim"];

/**
 * Refreshes the Supabase session cookie and sends signed-out requests for protected
 * pages to /giris. Roles and the active flag are checked in the layouts (lib/auth.ts).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let authHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          authHeaders = { ...authHeaders, ...headers };
          Object.entries(authHeaders).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Must run before anything else so a refreshed token reaches the response.
  const { data } = await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!data?.claims && isProtected) {
    const redirect = NextResponse.redirect(new URL("/giris", request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    Object.entries(authHeaders).forEach(([key, value]) => redirect.headers.set(key, value));
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml)$).*)",
  ],
};
