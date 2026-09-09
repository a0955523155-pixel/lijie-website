import crypto from "node:crypto";
import { STATE_COOKIE, cookie, publicOrigin, signPayload, sessionSecret } from "./line-auth-lib.js";

function safeReturn(v) {
  const s = String(v || "/line-booking.html");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/line-booking.html";
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  const clientId = String(process.env.LINE_LOGIN_CHANNEL_ID || "").trim();
  const clientSecret = String(process.env.LINE_LOGIN_CHANNEL_SECRET || "").trim();
  const bookingSecret = String(process.env.BOOKING_SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || "").trim();
  const missing = [];
  if (!clientId) missing.push("LINE_LOGIN_CHANNEL_ID");
  if (!clientSecret) missing.push("LINE_LOGIN_CHANNEL_SECRET");
  if (!bookingSecret) missing.push("BOOKING_SESSION_SECRET（或 LINE_CHANNEL_SECRET）");

  if (missing.length) {
    console.error("LINE_LOGIN_ENV_MISSING", { missing });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(500).send(`LINE Login 尚未設定完成\n\n缺少：${missing.join("、")}\n\n請到 Vercel → Project Settings → Environment Variables 新增到 Production，儲存後重新 Redeploy Production。`);
  }

  const origin = publicOrigin(req);
  const redirectUri = `${origin}/api/line-auth-callback`;
  const state = crypto.randomBytes(24).toString("base64url");
  const nonce = crypto.randomBytes(24).toString("base64url");
  const returnTo = safeReturn(req.query?.return);
  const stateToken = signPayload({ uid: "oauth", exp: Date.now() + 10 * 60 * 1000, state, nonce, returnTo }, bookingSecret);
  res.setHeader("Set-Cookie", cookie(STATE_COOKIE, stateToken, { maxAge: 600 }));
  res.setHeader("Cache-Control", "no-store");

  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "openid profile",
    nonce
  });
  return res.redirect(302, `https://access.line.me/oauth2/v2.1/authorize?${q.toString()}`);
}
