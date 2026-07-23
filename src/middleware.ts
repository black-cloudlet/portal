/**
 * Route protection. Every path except the public auth endpoints, the login
 * page, and static assets requires an authenticated session; unauthenticated
 * requests are redirected to Keycloak via the /login page. This is the single
 * gate in front of the whole console.
 */

import { auth, REAUTH_ERROR } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname === "/login" ||
    pathname === "/favicon.ico";

  // A session whose token could not be refreshed still exists, but its stale
  // access token only earns an "Invalid token: Signature has expired" from the
  // downstream APIs. Treat it like an unauthenticated request so the user is
  // sent back through sign-in to mint a fresh token instead of hitting that
  // error on a console page.
  const needsReauth = req.auth?.error === REAUTH_ERROR;

  if ((!req.auth || needsReauth) && !isPublic) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return Response.redirect(loginUrl);
  }
});

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
