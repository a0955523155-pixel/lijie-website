import crypto from "node:crypto";
import { BOOKING_RULES } from "../js/booking-rules.js";
import { lineConfig } from "../js/line-config.js";

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

function welcomeText() {
  return [
    "歡迎加入『俐姐的家』🌿",
    "",
    "這裡可以查詢空房、選擇入住／退房日期並送出預約申請。",
    "",
    "【住宿資訊】",
    `• 入住時間：${BOOKING_RULES.checkInFrom} 起`,
    `• 退房時間：${BOOKING_RULES.checkOutBy} 前`,
    `• 全館 5 間客房，最多入住 ${BOOKING_RULES.maxGuests} 人`,
    `• ${BOOKING_RULES.payment.depositMethod}`,
    `• ${BOOKING_RULES.payment.balanceMethods}`,
    `• ${BOOKING_RULES.payment.accountStatus}`,
    "",
    "要預約時，點下方『立即預約』開啟日期日曆即可。"
  ].join("\n");
}

function welcomeButtonMessage() {
  return {
    type: "template",
    altText: "俐姐的家｜立即預約",
    template: {
      type: "buttons",
      title: "俐姐的家｜住宿預約",
      text: "查看空房並選擇入住、退房日期",
      actions: [
        {
          type: "uri",
          label: "立即預約",
          uri: lineConfig.miniAppUrl
        }
      ]
    }
  };
}

function buildBookingReply(b) {
  return [
    `收到 ${b.name} 的預約申請 🌿`,
    "",
    `入住日期：${b.checkIn}`,
    `退房日期：${b.checkOut}`,
    `住宿晚數：${b.nights} 晚`,
    `入住人數：${b.people}`,
    b.phone && b.phone !== "未填" ? `聯絡電話：${b.phone}` : null,
    b.purpose && b.purpose !== "未填" ? `住宿需求：${b.purpose}` : null,
    b.notes && b.notes !== "未填" && b.notes !== "無" ? `備註：${b.notes}` : null,
    "",
    "【入住須知】",
    `• 最早入住：${BOOKING_RULES.checkInFrom}`,
    `• 最晚退房：${BOOKING_RULES.checkOutBy}`,
    `• 付款方式：${BOOKING_RULES.payment.depositMethod}；${BOOKING_RULES.payment.balanceMethods}。`,
    `• 匯款資訊：${BOOKING_RULES.payment.accountStatus}。`,
    ...BOOKING_RULES.notes.map(x => `• ${x}`),
    "",
    "以上資料已收到，目前仍為『預約申請』；待確認日期與訂金安排後，官方 LINE 會再通知您。"
  ].filter(Boolean).join("\n");
}

function keywordReply(text = "") {
  const t = text.replace(/\s+/g, "").toLowerCase();
  if (!t) return null;

  if (/預約|空房|日曆|日期|訂房/.test(t)) {
    return {
      text: [
        "可以直接用官方預約日曆選擇入住與退房日期 🌿",
        "",
        `入住：${BOOKING_RULES.checkInFrom} 起`,
        `退房：${BOOKING_RULES.checkOutBy} 前`,
        "",
        "點下方『立即預約』即可開始。"
      ].join("\n"),
      button: welcomeButtonMessage()
    };
  }

  if (/最多|幾人|人數|入住人數/.test(t)) {
    return { text: `俐姐的家整棟最多入住 ${BOOKING_RULES.maxGuests} 人。\n目前房型為雙人房 4 間、四人房 1 間，共 5 間房。` };
  }

  if (/入住|退房|checkin|checkout|時間/.test(t)) {
    return { text: `入住時間：${BOOKING_RULES.checkInFrom} 起\n退房時間：${BOOKING_RULES.checkOutBy} 前\n若預計較晚抵達，請先透過官方 LINE 告知。` };
  }

  if (/付款|訂金|現金|轉帳|匯款|帳號/.test(t)) {
    return {
      text: [
        "【付款方式】",
        `• ${BOOKING_RULES.payment.depositMethod}`,
        `• ${BOOKING_RULES.payment.balanceMethods}`,
        `• ${BOOKING_RULES.payment.accountStatus}`
      ].join("\n")
    };
  }

  if (/房間|房型|幾間/.test(t)) {
    return { text: `目前共有 5 間客房：雙人房 4 間、四人房 1 間，整棟最多入住 ${BOOKING_RULES.maxGuests} 人。` };
  }

  return null;
}

async function replyLine(replyToken, messages, token) {
  const normalized = (Array.isArray(messages) ? messages : [messages]).map(message =>
    typeof message === "string" ? { type: "text", text: message } : message
  );
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ replyToken, messages: normalized.slice(0, 5) })
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
  if (!secret || !token) {
    console.error("LINE environment variables are not configured");
    return res.status(500).json({ ok: false, error: "LINE environment variables are not configured" });
  }

  try {
    const raw = await readRawBody(req);
    const signature = req.headers["x-line-signature"];
    if (!verifyLineSignature(raw, signature, secret)) return res.status(401).json({ ok: false });

    const body = JSON.parse(raw.toString("utf8"));
    // LINE Developers 的 Verify 會送 events: []；一定直接回 200。
    if (!Array.isArray(body.events) || body.events.length === 0) return res.status(200).json({ ok: true });

    // 先快速回覆 LINE，避免超時；實際處理仍在同一 invocation 內完成。
    for (const event of body.events) {
      if (!event?.replyToken) continue;

      if (event.type === "follow") {
        await replyLine(event.replyToken, [welcomeText(), welcomeButtonMessage()], token);
        continue;
      }

      if (event.type !== "message" || event.message?.type !== "text") continue;

      const booking = parseBooking(event.message.text);
      if (booking) {
        await replyLine(event.replyToken, buildBookingReply(booking), token);
        continue;
      }

      const keyword = keywordReply(event.message.text);
      if (keyword) {
        const messages = [keyword.text];
        if (keyword.button) messages.push(keyword.button);
        await replyLine(event.replyToken, messages, token);
        continue;
      }

      // 一般聊天不搶話，只做輕量接收提示；後續可由人工接手。
      await replyLine(event.replyToken,
        "訊息已收到 😊\n若要查空房或預約，可傳『預約』，我會開啟入住／退房日期日曆；其他問題俐姐會再回覆您。",
        token
      );
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("LINE webhook error", error);
    return res.status(500).json({ ok: false });
  }
}
