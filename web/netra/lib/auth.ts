import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "netra_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1_000;

function getAuthSecret() {
  return (
    process.env.NETRA_AUTH_SECRET || process.env.NETRA_LOGIN_PASSWORD || ""
  );
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

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function credentialsAreValid(username: string, password: string) {
  return (
    Boolean(process.env.NETRA_LOGIN_USERNAME) &&
    Boolean(process.env.NETRA_LOGIN_PASSWORD) &&
    username === process.env.NETRA_LOGIN_USERNAME &&
    password === process.env.NETRA_LOGIN_PASSWORD
  );
}
