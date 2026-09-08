import { COOKIE_NAME, STATE_COOKIE, cookie, createBookingSession, parseCookies, publicOrigin, verifyPayload } from "./line-auth-lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  const clientSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  if (!clientId || !clientSecret) return res.status(500).send("LINE Login 尚未設定完成");

  try {
    const cookies = parseCookies(req);
    const statePayload = verifyPayload(cookies[STATE_COOKIE]);
    if (statePayload.uid !== "oauth" || String(req.query?.state || "") !== statePayload.state) throw new Error("OAUTH_STATE_INVALID");
    const code = String(req.query?.code || "");
    if (!code) throw new Error("OAUTH_CODE_MISSING");

    const origin = publicOrigin(req);
    const redirectUri = `${origin}/api/line-auth-callback`;
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret
    });
    const tokenResp = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody
    });
    const tokenData = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok || !tokenData.id_token) throw new Error(`LINE_TOKEN_EXCHANGE_FAILED_${tokenResp.status}`);

    const verifyBody = new URLSearchParams({ id_token: tokenData.id_token, client_id: clientId });
    const verifyResp = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyBody
    });
    const profile = await verifyResp.json().catch(() => ({}));
    if (!verifyResp.ok || !/^U[0-9a-f]{32}$/.test(String(profile.sub || ""))) throw new Error(`LINE_ID_TOKEN_INVALID_${verifyResp.status}`);
    if (String(profile.nonce || "") !== String(statePayload.nonce || "")) throw new Error("LINE_ID_TOKEN_NONCE_INVALID");

    const session = createBookingSession(profile.sub);
    res.setHeader("Set-Cookie", [
      cookie(COOKIE_NAME, session, { maxAge: 7 * 24 * 60 * 60 }),
      cookie(STATE_COOKIE, "", { maxAge: 1 })
    ]);
    res.setHeader("Cache-Control", "no-store");
    const returnTo = statePayload.returnTo || "/line-booking.html";
    const sep = returnTo.includes("?") ? "&" : "?";
    return res.redirect(302, `${returnTo}${sep}lineAuth=ok`);
  } catch (error) {
    console.error("LINE auth callback error", error);
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, "/line-booking.html?lineAuth=error");
  }
}
