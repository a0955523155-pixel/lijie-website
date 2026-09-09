import crypto from "node:crypto";
import { BOOKING_RULES } from "../js/booking-rules.js";
import { getBooking, putBooking, listBookingsByLineUser } from "./firestore-admin.js";
import { gmailReady, sendMail, adminNotificationEmail, cancellationRequestMail, refundRequestMail } from "./gmail-mailer.js";

function createBookingSession(userId, secret, ttlMs = 2 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + ttlMs })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function bookingUrlFor(userId, secret) {
  const session = createBookingSession(userId, secret);
  return `https://www.5-1bbs.com/line-booking.html?session=${encodeURIComponent(session)}`;
}
function bookingButtonMessage(url) {
  return {
    type: "template",
    altText: "俐姐的家｜開啟預約日曆",
    template: { type: "buttons", title: "俐姐的家｜住宿預約", text: "安全連線已建立，請開啟日曆選擇入住與退房日期。", actions: [
      { type: "uri", label: "開啟預約日曆", uri: url },
      { type: "message", label: "取消預約", text: "取消預約" }
    ]}
  };
}

function lineMainMenuMessage(url){
  return {
    type:"template",
    altText:"俐姐的家｜預約服務",
    template:{type:"buttons",title:"俐姐的家｜預約服務",text:"可立即預約、查詢已綁定訂單或查看取消預約須知。",actions:[
      {type:"uri",label:"立即預約",uri:url},
      {type:"message",label:"查詢訂單",text:"查詢訂單"},
      {type:"message",label:"取消預約",text:"取消預約"}
    ]}
  };
}
function bookingStatusLabel(status){
  return ({pending:"預約申請／待訂金",confirmed:"預約已成立",cancelled:"已取消"})[String(status||"")]||String(status||"處理中");
}
function customerOrderFlex(b,{justBound=false}={}){
  const total=Number(b.quotedTotal||b.totalAmount||0),deposit=Number(b.depositRequired||3000),paid=Number(b.paidAmount||b.amountReceived||0);
  const remain=Math.max(0,total-paid);
  const status=bookingStatusLabel(b.status);
  return {type:"flex",altText:`俐姐的家｜訂單 ${b.id}`,contents:{type:"bubble",size:"mega",
    header:{type:"box",layout:"vertical",backgroundColor:"#173A35",paddingAll:"20px",contents:[
      {type:"text",text:"LIJIE'S HOME",color:"#CDBD92",size:"xs",weight:"bold"},
      {type:"text",text:justBound?"LINE 訂單綁定完成":"我的預約訂單",color:"#FFFFFF",weight:"bold",size:"xl"},
      {type:"text",text:`編號 ${b.id}`,color:"#D7E4DF",size:"xs",wrap:true}]},
    body:{type:"box",layout:"vertical",paddingAll:"20px",spacing:"sm",contents:[
      {type:"text",text:`${b.startDate||"—"} → ${b.endDate||"—"}`,weight:"bold",size:"xl",color:"#173A35",wrap:true},
      {type:"text",text:`${b.people?`${b.people} 人｜`:""}${status}`,size:"sm",color:"#66736E",wrap:true},
      {type:"separator",margin:"md",color:"#E7E1D7"},
      {type:"text",text:`姓名｜${b.guestName||"未填"}
電話｜${b.phone||"未填"}
Email｜${b.email||"未填"}`,size:"sm",wrap:true,color:"#26332F",lineSpacing:"4px"},
      ...(total>0?[{type:"text",text:`住宿總額｜NT$ ${total.toLocaleString("zh-TW")}
固定訂金｜NT$ ${deposit.toLocaleString("zh-TW")}
目前已收｜NT$ ${paid.toLocaleString("zh-TW")}
尚餘｜NT$ ${remain.toLocaleString("zh-TW")}`,size:"sm",wrap:true,color:"#36534B",margin:"md",lineSpacing:"4px"}]:[]),
      {type:"text",text:"此 LINE 帳號已與本訂單綁定；同一筆訂單無法再綁定其他 LINE 使用者。",size:"xs",wrap:true,color:"#7A8581",margin:"md"}]},
    footer:{type:"box",layout:"vertical",paddingAll:"14px",spacing:"sm",contents:[
      {type:"button",style:"secondary",height:"sm",action:{type:"message",label:"取消預約",text:`取消預約 ${b.id}`}}
    ]}}};
}
function looksLikeBookingId(text){
  const t=String(text||"").trim();
  return /^(?:TEST-)?[WB][A-Z0-9]{6,}$/i.test(t)||/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t);
}
async function bindBookingToLine(bookingId,userId){
  const id=String(bookingId||"").trim();
  const uid=String(userId||"").trim();
  const b=await getBooking(id);
  if(!b) throw new Error("BOOKING_NOT_FOUND");
  if(b.lineUserId && b.lineUserId!==uid) throw new Error("BOOKING_ALREADY_BOUND");
  if(!b.lineUserId){
    const data={...b,lineUserId:uid,lineBoundAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    delete data.id;
    await putBooking(id,data);
    return {id,...data,justBound:true};
  }
  return {...b,justBound:false};
}


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
          uri: "https://www.5-1bbs.com/line-booking.html"
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


function bookingFlexReply(b) {
  const infoRows = [
    ["姓名", b.name], ["電話", b.phone || "未填"], ["人數", b.people || "未填"],
    ["需求", b.purpose || "未填"], ["備註", b.notes || "沒有"]
  ];
  const row = ([label, value]) => ({
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#7A8581", flex: 2 },
      { type: "text", text: String(value), size: "sm", color: "#1F2E2B", weight: "bold", flex: 5, wrap: true }
    ]
  });
  return {
    type: "flex",
    altText: `俐姐的家｜預約申請已收到 ${b.checkIn} → ${b.checkOut}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box", layout: "vertical", paddingAll: "20px", spacing: "xs", backgroundColor: "#173A35",
        contents: [
          { type: "text", text: "俐姐的家", color: "#FFFFFF", weight: "bold", size: "xl" },
          { type: "text", text: "預約申請已收到", color: "#D7E4DF", size: "sm" }
        ]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "20px", spacing: "md",
        contents: [
          { type: "box", layout: "vertical", spacing: "sm", contents: [
            { type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: "#F7F3EA", cornerRadius: "12px", contents: [
              { type: "text", text: "📅 入住日期", size: "xs", color: "#8B7E61", weight: "bold" },
              { type: "text", text: b.checkIn, weight: "bold", size: "xl", color: "#173A35", margin: "xs", wrap: true },
              { type: "text", text: `🕒 ${BOOKING_RULES.checkInFrom} 起`, size: "xs", color: "#6C7773", margin: "xs" }
            ]},
            { type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: "#F7F3EA", cornerRadius: "12px", contents: [
              { type: "text", text: "🌙 退房日期", size: "xs", color: "#8B7E61", weight: "bold" },
              { type: "text", text: b.checkOut, weight: "bold", size: "xl", color: "#173A35", margin: "xs", wrap: true },
              { type: "text", text: `🕛 ${BOOKING_RULES.checkOutBy} 前`, size: "xs", color: "#6C7773", margin: "xs" }
            ]}
          ]},
          { type: "text", text: `✨ ${b.nights} 晚｜${b.people || "人數未填"}`, size: "sm", color: "#6C7773", weight: "bold", align: "center" },
          { type: "separator", margin: "md" },
          { type: "box", layout: "vertical", spacing: "sm", margin: "md", contents: infoRows.map(row) },
          { type: "separator", margin: "md" },
          { type: "text", text: "🌿 入住須知", weight: "bold", size: "md", color: "#173A35", margin: "md" },
          { type: "box", layout: "horizontal", spacing: "sm", contents: [
            { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#F3F6F4", flex: 1, contents: [
              { type: "text", text: "最早入住", size: "xs", color: "#7A8581" },
              { type: "text", text: BOOKING_RULES.checkInFrom, size: "lg", weight: "bold", color: "#173A35" }
            ]},
            { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#F3F6F4", flex: 1, contents: [
              { type: "text", text: "最晚退房", size: "xs", color: "#7A8581" },
              { type: "text", text: BOOKING_RULES.checkOutBy, size: "lg", weight: "bold", color: "#173A35" }
            ]}
          ]},
          { type: "text", text: `• ${BOOKING_RULES.payment.depositMethod}\n• ${BOOKING_RULES.payment.balanceMethods}\n• ${BOOKING_RULES.payment.accountStatus}`, size: "xs", color: "#4F5D59", wrap: true, margin: "md" },
          { type: "text", text: "目前為預約申請，實際成立仍以俐姐於官方 LINE 確認為準。", size: "xs", color: "#7A8581", wrap: true }
        ]
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "sm",
        contents: [
          { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#FFF7DF", cornerRadius: "8px", contents: [
            { type: "text", text: "🟡 等待俐姐確認", align: "center", weight: "bold", size: "sm", color: "#8A6400" }
          ]},
          { type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "再次查看預約日曆", uri: "https://www.5-1bbs.com/line-booking.html" } }
        ]
      }
    }
  };
}

function keywordReply(text = "") {
  const t = text.replace(/\s+/g, "").toLowerCase();
  if (!t) return null;

  // 取消類關鍵字必須優先於「預約」，避免「取消預約」被誤判成新預約。
  if (/取消訂單|取消預約|取消訂房|取消預定|取消預訂|我要取消|我想取消|想取消|退訂|取消住宿|不住了|行程取消/.test(t)) {
    return {
      text: [
        "【取消預約須知】",
        "如需取消，請先閱讀以下內容：",
        "",
        "1. 提出取消不代表訂單立即取消，須由俐姐核對訂單後才會正式處理。",
        "2. 取消原因為必填，後台會永久保留取消原因與處理紀錄。",
        "3. 若已支付訂金，訂金是否保留、部分退款或全額退款，會依該筆訂單約定與實際情況確認，不會由系統自動退款。",
        "4. 正式取消完成後，原住宿日期才會重新釋出。",
        "",
        "請回覆：『訂單編號＋取消原因』。",
        "例如：BXXXXXXX，行程臨時取消。",
        "",
        "若忘記訂單編號，可先傳『查詢訂單』。"
      ].join("\n")
    };
  }

  if (/退款|退費|申請退款|我要退款|想退款/.test(t)) {
    return { text: [
      "【退款申請】",
      "若您需要申請退款，請回覆：『退款 訂單編號＋原因』。",
      "例如：退款 WABC1234，行程臨時取消。",
      "",
      "送出申請後，客戶與民宿管理者都會收到 Email 通知；實際退款金額與方式仍由民宿後台核對後處理。",
      "若忘記訂單編號，可先傳『查詢訂單』。"
    ].join("\n") };
  }

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

  if (/價格|價錢|房價|費用|多少錢|一晚多少|住宿費/.test(t)) {
    return {
      text: [
        "俐姐的家房價會依入住日期計算 🌿",
        "",
        "平日、週五／週六、國定假日與連續假期價格可能不同，因此我們不在官網放一個固定價格，避免客人看到錯誤金額。",
        "",
        "請點下方『立即預約』選擇實際入住／退房日期；送出預約後，LINE 會直接顯示這次日期的系統試算金額。",
        "",
        "※ 特殊活動、連假或臨時方案仍以俐姐最後確認的金額為準。"
      ].join("\n"),
      button: welcomeButtonMessage()
    };
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

function parseServiceRequest(text){
  const raw=String(text||"").trim();
  const refund=/^退款\s*/.test(raw)||/退款|退費/.test(raw);
  const cancel=/取消預約|取消訂房|取消訂單|取消預定|取消預訂|我要取消|我想取消|退訂|取消住宿|不住了/.test(raw);
  if(!refund&&!cancel)return null;
  const idMatch=raw.match(/(?:TEST-)?[WB][A-Z0-9]{6,}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if(!idMatch)return null;
  const id=idMatch[0];
  let reason=raw.replace(idMatch[0],"").replace(/退款|退費|申請退款|我要退款|想退款|取消預約|取消訂房|取消訂單|取消預定|取消預訂|我要取消|我想取消|退訂|取消住宿|不住了|行程取消/g," ").replace(/[，,：:｜|]/g," ").trim();
  return {type:refund?"refund":"cancel",id,reason};
}
async function submitServiceRequest(reqInfo,uid){
  const b=await getBooking(reqInfo.id); if(!b)throw new Error("BOOKING_NOT_FOUND");
  if(b.lineUserId&&uid&&b.lineUserId!==uid)throw new Error("BOOKING_LINE_MISMATCH");
  if(!b.lineUserId&&uid){b.lineUserId=uid;b.lineBoundAt=new Date().toISOString();}
  if(!reqInfo.reason)throw new Error("REQUEST_REASON_REQUIRED");
  const now=new Date().toISOString();
  if(reqInfo.type==="cancel") Object.assign(b,{cancellationRequestStatus:"pending",cancellationRequestedAt:now,cancellationRequestReason:reqInfo.reason,cancellationRequestedBy:"customer",updatedAt:now});
  else Object.assign(b,{refundRequestStatus:"pending",refundRequestedAt:now,refundRequestReason:reqInfo.reason,refundRequestedBy:"customer",updatedAt:now});
  const save={...b};delete save.id;await putBooking(reqInfo.id,save);
  if(gmailReady()){
    const fn=reqInfo.type==="cancel"?cancellationRequestMail:refundRequestMail;
    if(b.email){try{const m=fn({id:reqInfo.id,...b},reqInfo.reason,{admin:false});await sendMail({to:b.email,subject:m.subject,text:m.text,html:m.html});}catch(e){console.warn("customer service request email failed",e)}}
    const adminTo=adminNotificationEmail(); if(adminTo){try{const m=fn({id:reqInfo.id,...b},reqInfo.reason,{admin:true});await sendMail({to:adminTo,subject:m.subject,text:m.text,html:m.html});}catch(e){console.warn("admin service request email failed",e)}}
  }
  return {id:reqInfo.id,...b};
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
        await replyLine(event.replyToken, [welcomeText(), lineMainMenuMessage(bookingUrlFor(event.source?.userId, secret))], token);
        continue;
      }

      if (event.type === "postback") { continue; }

      if (event.type !== "message" || event.message?.type !== "text") continue;

      const customerInput=String(event.message.text||"").trim();
      const uid=String(event.source?.userId||"").trim();

      const serviceReq=parseServiceRequest(customerInput);
      if(serviceReq){
        try{
          const saved=await submitServiceRequest(serviceReq,uid);
          await replyLine(event.replyToken, serviceReq.type==="cancel"
            ? `✅ 已收到取消預約申請。\n訂單：${saved.id}\n原因：${serviceReq.reason}\n\n目前訂單尚未正式取消、日期也尚未釋出。後續訂金保留或退款方式會由民宿後台確認。`
            : `✅ 已收到退款申請。\n訂單：${saved.id}\n原因：${serviceReq.reason}\n\n退款尚未完成，實際退款金額與方式會由民宿後台核對後處理。`, token);
        }catch(e){
          const m=String(e?.message||e);
          await replyLine(event.replyToken,m.includes("REQUEST_REASON_REQUIRED")?"請補上申請原因，例如：取消預約 WABC1234，行程臨時取消。":m.includes("BOOKING_NOT_FOUND")?"找不到這個訂單編號，請先傳『查詢訂單』確認。":m.includes("BOOKING_LINE_MISMATCH")?"這筆訂單已綁定其他 LINE 使用者，無法由目前帳號提出申請。":"目前無法送出申請，請稍後再試。",token);
        }
        continue;
      }

      // 官網訂單可直接在官方 LINE 輸入訂單編號完成一次性綁定。
      if(looksLikeBookingId(customerInput)){
        try{
          const bound=await bindBookingToLine(customerInput,uid);
          await replyLine(event.replyToken,[
            bound.justBound?`✅ 訂單 ${bound.id} 已綁定到目前這個 LINE 帳號。之後傳「查詢訂單」即可查看。`:`訂單 ${bound.id} 已經綁定目前這個 LINE 帳號。`,
            customerOrderFlex(bound,{justBound:bound.justBound})
          ],token);
        }catch(e){
          const m=String(e?.message||e);
          await replyLine(event.replyToken,m.includes("BOOKING_ALREADY_BOUND")
            ? "⚠️ 這筆訂單已綁定其他 LINE 使用者，為保護預約資料，無法重複綁定。若需要協助請直接留言給俐姐。"
            : m.includes("BOOKING_NOT_FOUND")
              ? "找不到這個訂單編號，請確認英文字母、數字與連字號是否完整。"
              : "目前無法綁定訂單，請稍後再試。",token);
        }
        continue;
      }

      if(/^查詢訂單$/.test(customerInput.replace(/\s+/g,""))){
        try{
          const orders=await listBookingsByLineUser(uid,8);
          if(!orders.length){
            await replyLine(event.replyToken,"目前這個 LINE 帳號還沒有綁定訂單。\n\n若您是在電腦版官網完成預約，請直接在這裡輸入『預約編號』，系統會把該筆訂單同步到目前這個 LINE 帳號。\n\n一筆訂單最多只能綁定一位 LINE 使用者。",token);
          }else{
            await replyLine(event.replyToken,[{type:"text",text:`找到 ${orders.length} 筆已綁定訂單：`},...orders.slice(0,4).map(b=>customerOrderFlex(b))],token);
          }
        }catch(e){
          console.error("customer order query failed",e);
          await replyLine(event.replyToken,"目前無法查詢訂單，請稍後再試。",token);
        }
        continue;
      }

      const booking = parseBooking(event.message.text);
      if (booking) {
        await replyLine(event.replyToken, bookingFlexReply(booking), token);
        continue;
      }

      const keyword = keywordReply(event.message.text);
      if (keyword) {
        const messages = [keyword.text];
        if (keyword.button) messages.push(bookingButtonMessage(bookingUrlFor(event.source?.userId, secret)));
        await replyLine(event.replyToken, messages, token);
        continue;
      }

      // 一般聊天不搶話，只做輕量接收提示；後續可由人工接手。
      await replyLine(event.replyToken,
        "訊息已收到 😊\n可傳『立即預約』、『查詢訂單』或『取消預約』使用預約服務；其他問題俐姐會再回覆您。",
        token
      );
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("LINE webhook error", error);
    return res.status(500).json({ ok: false });
  }
}
