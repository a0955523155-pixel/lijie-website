import crypto from "node:crypto";

export const COOKIE_NAME = "lijie_booking_session";
export const STATE_COOKIE = "lijie_line_oauth_state";

export function sessionSecret() {
  return process.env.BOOKING_SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || "";
}

export function signPayload(payload, secret = sessionSecret()) {
  if (!secret) throw new Error("SESSION_SECRET_MISSING");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload(token, secret = sessionSecret()) {
  if (!token || !secret) throw new Error("BOOKING_SESSION_REQUIRED");
  const [body, sig, extra] = String(token).split(".");
  if (!body || !sig || extra) throw new Error("BOOKING_SESSION_INVALID");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("BOOKING_SESSION_INVALID");
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { throw new Error("BOOKING_SESSION_INVALID"); }
  if (!payload?.uid || !payload?.exp) throw new Error("BOOKING_SESSION_INVALID");
  if (Date.now() > Number(payload.exp)) throw new Error("BOOKING_SESSION_EXPIRED");
  return payload;
}

export function createBookingSession(userId, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  return signPayload({ uid: userId, exp: Date.now() + ttlMs, v: 1 });
}

export function parseCookies(req) {
  const raw = req.headers?.cookie || "";
  const out = {};
  for (const piece of raw.split(";")) {
    const i = piece.indexOf("=");
    if (i < 0) continue;
    const k = piece.slice(0, i).trim();
    const v = piece.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookie(name, value, { maxAge = 0, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "Secure", "SameSite=Lax"];
  if (httpOnly) parts.push("HttpOnly");
  if (maxAge) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  return parts.join("; ");
}

export function publicOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "www.5-1bbs.com").split(",")[0].trim();
  return `${proto}://${host}`;
}
