import crypto from "node:crypto";
import { STATE_COOKIE, cookie, publicOrigin, signPayload, sessionSecret } from "./line-auth-lib.js";

function safeReturn(v) {
  const s = String(v || "/line-booking.html");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/line-booking.html";
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  const clientSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  const secret = sessionSecret();
  if (!clientId || !clientSecret || !secret) {
    console.error("LINE Login env missing", { clientId: !!clientId, clientSecret: !!clientSecret, sessionSecret: !!secret });
    return res.status(500).send("LINE Login 尚未設定完成");
  }

  const origin = publicOrigin(req);
  const redirectUri = `${origin}/api/line-auth-callback`;
  const state = crypto.randomBytes(24).toString("base64url");
  const nonce = crypto.randomBytes(24).toString("base64url");
  const returnTo = safeReturn(req.query?.return);
  const stateToken = signPayload({ uid: "oauth", exp: Date.now() + 10 * 60 * 1000, state, nonce, returnTo }, secret);
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
