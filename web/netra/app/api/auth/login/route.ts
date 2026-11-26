import { NextResponse } from "next/server";
import {
  createSession,
  credentialsAreValid,
  getSessionCookieName,
} from "@/lib/auth";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1_000;
const attemptsByIp = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const now = Date.now();
  const record = attemptsByIp.get(ip);

  if (record && record.resetAt > now && record.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      {
        success: false,
        error: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.",
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const username = String(body?.username || "");
  const password = String(body?.password || "");

  if (!credentialsAreValid(username, password)) {
    const nextCount = record && record.resetAt > now ? record.count + 1 : 1;
    attemptsByIp.set(ip, { count: nextCount, resetAt: now + WINDOW_MS });

    return NextResponse.json(
      { success: false, error: "Username atau password salah" },
      { status: 401 },
    );
  }

  attemptsByIp.delete(ip);

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
