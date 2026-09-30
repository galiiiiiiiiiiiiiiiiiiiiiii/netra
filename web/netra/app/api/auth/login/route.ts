import { NextResponse } from "next/server";
import {
  createSession,
  credentialsAreValid,
  getSessionCookieName,
} from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username || "");
  const password = String(body?.password || "");

  if (!credentialsAreValid(username, password)) {
    return NextResponse.json(
      { success: false, error: "Username atau password salah" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set(getSessionCookieName(), createSession(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60,
    path: "/",
  });

  return response;
}
