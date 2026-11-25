import { NextResponse } from "next/server";
import { getSessionCookieName, isValidSession } from "@/lib/auth";

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const session = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${getSessionCookieName()}=`))
    ?.split("=")
    .slice(1)
    .join("=");

  return NextResponse.json({ authenticated: isValidSession(session) });
}
