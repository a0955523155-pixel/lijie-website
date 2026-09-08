import { BOOKING_RULES } from "../js/booking-rules.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function parseDateKey(key) {
  if (!DATE_RE.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

function normalizeBooking(input = {}) {
  const checkIn = clean(input.checkIn, 10);
  const checkOut = clean(input.checkOut, 10);
  const a = parseDateKey(checkIn);
  const b = parseDateKey(checkOut);
  if (!a || !b || b <= a) throw new Error("INVALID_DATES");
  const nights = Math.round((b - a) / 86400000);
  if (nights < 1 || nights > 30) throw new Error("INVALID_NIGHTS");
  const peopleRaw = Number.parseInt(String(input.people ?? ""), 10);
  const people = Number.isFinite(peopleRaw) ? Math.min(Math.max(peopleRaw, 1), 12) : null;
  const name = clean(input.name, 60);
  if (!name) throw new Error("NAME_REQUIRED");
  return {
    checkIn,
    checkOut,
    nights,
    name,
    phone: clean(input.phone, 40),
    people,
    purpose: clean(input.purpose, 120),
    notes: clean(input.notes, 500),
    source: clean(input.source, 30) || "miniapp"
  };
}

async function verifyIdToken(idToken, clientId) {
  const body = new URLSearchParams({ id_token: idToken, client_id: clientId });
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.sub) throw new Error("INVALID_LINE_ID_TOKEN");
  return data;
}

function customerMessages(b) {
  const details = [
    "🌿 俐姐的家｜預約申請已收到",
    "",
    `入住日期：${b.checkIn}`,
    `退房日期：${b.checkOut}`,
    `住宿晚數：${b.nights} 晚`,
    `入住人數：${b.people ? `${b.people} 人` : "未填"}`,
    b.purpose ? `住宿需求：${b.purpose}` : null,
    b.notes ? `備註：${b.notes}` : null
  ].filter(Boolean).join("\n");

  const rules = [
    "【入住須知】",
    `• 入住時間：${BOOKING_RULES.checkInFrom} 起`,
    `• 退房時間：${BOOKING_RULES.checkOutBy} 前`,
    ...BOOKING_RULES.notes.map(x => `• ${x}`),
    "",
    "此為預約申請，實際訂房成立仍以俐姐於官方 LINE 最終確認為準。"
  ].join("\n");
  return [{ type: "text", text: details }, { type: "text", text: rules }];
}

function ownerMessage(b, userId) {
  return [
    "【官網／MINI App 新預約申請】",
    `姓名：${b.name}`,
    `入住：${b.checkIn}`,
    `退房：${b.checkOut}（${b.nights} 晚）`,
    `人數：${b.people ? `${b.people} 人` : "未填"}`,
    b.phone ? `電話：${b.phone}` : null,
    b.purpose ? `需求：${b.purpose}` : null,
    b.notes ? `備註：${b.notes}` : null,
    `來源：${b.source}`,
    `LINE userId：${userId}`
  ].filter(Boolean).join("\n");
}

async function pushMessages(to, messages, token) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ to, messages })
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`LINE_PUSH_FAILED ${response.status} ${text}`);
    error.code = "LINE_PUSH_FAILED";
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const miniAppChannelId = process.env.LINE_MINIAPP_CHANNEL_ID || "2011502071";
  if (!accessToken) return res.status(500).json({ ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN is not configured" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const idToken = clean(body.idToken, 5000);
    if (!idToken) return res.status(401).json({ ok: false, error: "LINE ID token required" });

    const verified = await verifyIdToken(idToken, miniAppChannelId);
    const booking = normalizeBooking(body.booking);
    const userId = verified.sub;

    await pushMessages(userId, customerMessages(booking), accessToken);

    const notifyTo = process.env.LINE_BOOKING_NOTIFY_TO;
    if (notifyTo && notifyTo !== userId) {
      try { await pushMessages(notifyTo, [{ type: "text", text: ownerMessage(booking, userId) }], accessToken); }
      catch (e) { console.warn("Owner notification failed", e); }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    if (error?.code === "LINE_PUSH_FAILED") return res.status(409).json({ ok: false, code: "LINE_PUSH_FAILED", error: "Official LINE cannot message this user yet" });
    const message = String(error?.message || "UNKNOWN_ERROR");
    const status = message === "INVALID_LINE_ID_TOKEN" ? 401 : 400;
    return res.status(status).json({ ok: false, error: message });
  }
}
