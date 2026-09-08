export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  const status = {
    LINE_LOGIN_CHANNEL_ID: !!String(process.env.LINE_LOGIN_CHANNEL_ID || "").trim(),
    LINE_LOGIN_CHANNEL_SECRET: !!String(process.env.LINE_LOGIN_CHANNEL_SECRET || "").trim(),
    BOOKING_SESSION_SECRET: !!String(process.env.BOOKING_SESSION_SECRET || "").trim(),
    LINE_CHANNEL_SECRET: !!String(process.env.LINE_CHANNEL_SECRET || "").trim(),
    LINE_CHANNEL_ACCESS_TOKEN: !!String(process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim(),
  };
  const loginReady = status.LINE_LOGIN_CHANNEL_ID && status.LINE_LOGIN_CHANNEL_SECRET && (status.BOOKING_SESSION_SECRET || status.LINE_CHANNEL_SECRET);
  const messagingReady = status.LINE_CHANNEL_SECRET && status.LINE_CHANNEL_ACCESS_TOKEN;
  res.setHeader("Cache-Control", "no-store");
  return res.status(loginReady && messagingReady ? 200 : 503).json({
    ok: loginReady && messagingReady,
    loginReady,
    messagingReady,
    environment: process.env.VERCEL_ENV || null,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8) : null,
    variables: status
  });
}
