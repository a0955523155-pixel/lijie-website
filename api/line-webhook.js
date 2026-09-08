import crypto from "node:crypto";
import { BOOKING_RULES } from "../js/booking-rules.js";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeEqual(a, b) {
  try {
    const x = Buffer.from(a || "", "base64");
    const y = Buffer.from(b || "", "base64");
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

function verifyLineSignature(rawBody, signature, secret) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEqual(expected, signature);
}

function parseBooking(text = "") {
  if (!text.startsWith("【俐姐的家｜預約申請】")) return null;
  const value = label => {
    const m = text.match(new RegExp(`^${label}：(.+)$`, "m"));
    return m ? m[1].trim() : "未填";
  };
  const checkoutRaw = value("退房");
  const checkout = checkoutRaw.replace(/（.*?晚.*?）/, "").trim();
  const nightsMatch = checkoutRaw.match(/（(\d+)\s*晚/);
  return {
    checkIn: value("入住"),
    checkOut: checkout,
    nights: nightsMatch ? nightsMatch[1] : "—",
    name: value("姓名"),
    phone: value("電話"),
    people: value("人數"),
    purpose: value("需求"),
    notes: value("備註")
  };
}

function buildReply(b) {
  return [
    `收到 ${b.name} 的預約申請 🌿`,
    "",
    `入住日期：${b.checkIn}`,
    `退房日期：${b.checkOut}`,
    `住宿晚數：${b.nights} 晚`,
    `入住人數：${b.people}`,
    b.purpose && b.purpose !== "未填" ? `住宿需求：${b.purpose}` : null,
    "",
    "【入住須知】",
    `• 最早入住時間：${BOOKING_RULES.checkInFrom}`,
    `• 最晚退房時間：${BOOKING_RULES.checkOutBy}`,
    ...BOOKING_RULES.notes.map(x => `• ${x}`),
    "",
    "以上已收到，日期目前仍為『預約申請』，俐姐確認後會再於 LINE 回覆您。"
  ].filter(Boolean).join("\n");
}

async function replyLine(replyToken, text, token) {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] })
  });
  if (!r.ok) throw new Error(`LINE reply failed: ${r.status} ${await r.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  const secret = process.env.LINE_CHANNEL_SECRET;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!secret || !token) return res.status(500).json({ ok: false, error: "LINE environment variables are not configured" });

  try {
    const raw = await readRawBody(req);
    const signature = req.headers["x-line-signature"];
    if (!verifyLineSignature(raw, signature, secret)) return res.status(401).json({ ok: false });

    const body = JSON.parse(raw.toString("utf8"));
    // LINE Developers 的 Verify 會送 events: []；正常回 200 即可。
    if (!Array.isArray(body.events) || body.events.length === 0) return res.status(200).json({ ok: true });

    for (const event of body.events) {
      if (event?.type !== "message" || event?.message?.type !== "text" || !event?.replyToken) continue;
      const booking = parseBooking(event.message.text);
      if (!booking) continue;
      await replyLine(event.replyToken, buildReply(booking), token);
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false });
  }
}
