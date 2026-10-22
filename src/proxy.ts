import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionExpiry, shouldRenew, signSession } from "@/lib/session";

// Every page and photo needs the login; only the login page, the database's 10-minute call (which brings its
// own secret) and the app's icons do not. A login in use is renewed, so a phone never gets logged out.

const OPEN = ["/login", "/api/cron", "/manifest.webmanifest", "/icon.svg", "/apple-icon.png"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return NextResponse.next();

  const expires = await sessionExpiry(request.cookies.get(SESSION_COOKIE)?.value);
  if (expires === null) {
    if (pathname.startsWith("/api/")) return new NextResponse("Not logged in", { status: 401 });
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next();
  if (shouldRenew(expires)) {
    const session = await signSession();
    response.cookies.set(SESSION_COOKIE, session.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expires,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
