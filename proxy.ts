import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The admin studio and its generation API are local-only tools. They are
// exposed only when ADMIN_ENABLED=true (set in .env.local for local dev).
// In the deployed site the flag is unset, so /admin and /api/* return 404 and
// the public marketing pages are all that is reachable.
export function proxy(_req: NextRequest) {
  if (process.env.ADMIN_ENABLED !== "true") {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*"],
};
