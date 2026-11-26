import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "netra_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1_000;

function getAuthSecret() {
  return (
    process.env.NETRA_AUTH_SECRET || process.env.NETRA_LOGIN_PASSWORD || ""
  );
}

function safeCompare(left: string, right: string) {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

function sign(payload: string) {
  return createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64url");
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function createSession(username: string) {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const payload = `${username}.${expiresAt}`;

  return `${payload}.${sign(payload)}`;
}

export function isValidSession(value?: string) {
  if (!value || !getAuthSecret()) {
    return false;
  }

  const signatureIndex = value.lastIndexOf(".");
  if (signatureIndex <= 0) {
    return false;
  }
  const payload = value.slice(0, signatureIndex);
  const signature = value.slice(signatureIndex + 1);
  const expiry = Number(payload.slice(payload.lastIndexOf(".") + 1));
  const expectedSignature = sign(payload);

  if (
    !payload ||
    !signature ||
    !Number.isFinite(expiry) ||
    expiry < Date.now()
  ) {
    return false;
  }

  return safeCompare(signature, expectedSignature);
}

export function credentialsAreValid(username: string, password: string) {
  const expectedUser = process.env.NETRA_LOGIN_USERNAME || "";
  const expectedPass = process.env.NETRA_LOGIN_PASSWORD || "";
  if (!expectedUser || !expectedPass) {
    return false;
  }
  const userMatch = safeCompare(username, expectedUser);
  const passMatch = safeCompare(password, expectedPass);
  return userMatch && passMatch;
}

export function isRequestAuthorized(request: Request) {
  const internalSecret = process.env.NETRA_INTERNAL_SECRET || "";
  const providedSecret = request.headers.get("x-netra-internal-secret") || "";

  if (internalSecret && providedSecret && safeCompare(providedSecret, internalSecret)) {
    return true;
  }

  const cookieHeader = request.headers.get("cookie") || "";
  const session = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  return isValidSession(session);
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { success: false, error: "Unauthorized" },
    { status: 401 },
  );
}
