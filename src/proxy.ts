import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/signup", "/forgot-password", "/auth", "/invite", "/u/", "/setup", "/api/webhooks", "/api/health"];
const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

/**
 * Refreshes the Supabase session cookie and performs an optimistic redirect for
 * signed-out visitors. This is a convenience only: every page and server action
 * re-checks the session, and RLS enforces authorisation in the database.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (pathname === "/setup" || pathname === "/" || pathname.startsWith("/api/health")) return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const signedIn = data.user !== null;

  const isPublic = pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!signedIn && !isPublic) {
    const login = new URL("/login", request.url);
    if (pathname !== "/dashboard") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  if (signedIn && AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
