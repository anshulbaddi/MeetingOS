import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublicRoute =
    pathname === "/" ||
    pathname === "/donate" ||
    pathname === "/contact" ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/share") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/chat/public" ||
    pathname === "/api/donate/checkout" ||
    pathname === "/api/contact";

  if (req.auth && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (!req.auth && !isPublicRoute) {
    return NextResponse.redirect(new URL("/", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
