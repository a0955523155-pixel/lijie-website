import { COOKIE_NAME, parseCookies, verifyPayload } from "./line-auth-lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  res.setHeader("Cache-Control", "no-store");
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    const payload = verifyPayload(token);
    return res.status(200).json({ ok: true, authenticated: true, expiresAt: Number(payload.exp) });
  } catch (e) {
    return res.status(200).json({ ok: true, authenticated: false, reason: String(e?.message || "NO_SESSION") });
  }
}
