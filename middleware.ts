import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const pathname = request.nextUrl.pathname;

  // getUser() does a network call to Supabase. If Supabase is briefly
  // unreachable (DNS blip, restart, BGP routing issue) this rejects with
  // "fetch failed". Without a guard, every request in the matcher throws an
  // unhandled error and 500s. Catch it so a transient Supabase outage doesn't
  // take down every page load.
  let user = null;
  let authCheckFailed = false;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (err) {
    authCheckFailed = true;
    console.error(
      "[middleware] supabase.auth.getUser() failed (Supabase unreachable?):",
      err instanceof Error ? err.message : err
    );
  }

  // Fail closed: if we couldn't verify the session, don't pass the request
  // through as if it were anonymous-but-fine. On a protected route send the
  // user to /login (the dashboard layout fetches everything client-side under
  // RLS, so the worst case without this is an empty shell — but /login is the
  // honest response). On an already-public route just continue.
  if (authCheckFailed) {
    const isPublicRouteOnFailure = ["/login", "/register", "/forgot-password", "/reset-password", "/auth/callback", "/pay"]
      .some((route) => pathname.startsWith(route)) || pathname.startsWith("/.well-known");
    if (isPublicRouteOnFailure) {
      return supabaseResponse;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Allow .well-known paths (Digital Asset Links for Android TWA)
  if (pathname.startsWith("/.well-known")) {
    return NextResponse.next();
  }

  // Public routes that don't require authentication
  // `/pay/*` is the public customer-facing payment thank-you page (and any
  // future public payment pages). Customers paying via a shared Cardcom link
  // are not logged in, so they must reach it without being bounced to /login.
  const publicRoutes = ["/login", "/register", "/forgot-password", "/reset-password", "/auth/callback", "/pay"];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

  // Auth-only pages: a logged-in user has no business seeing login/register, so
  // they get bounced to the dashboard. NOTE: `/pay/*` is public but NOT an auth
  // page — a logged-in admin must be able to open a payment link, so it is
  // deliberately excluded here (otherwise admins get redirected to the dashboard).
  const authRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  // If user is not authenticated and trying to access protected route
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Save the original URL to redirect after login
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // If user is authenticated and trying to access login/register
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files (images, sw.js, manifest.json)
     * - api routes
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|api).*)",
  ],
};
