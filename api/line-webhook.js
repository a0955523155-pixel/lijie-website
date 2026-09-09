import crypto from "node:crypto";
import { BOOKING_RULES } from "../js/booking-rules.js";
import { lineConfig } from "../js/line-config.js";
import { getBooking, listPendingBookings, setBookingStatus, firestoreDiagnostic, firestoreReady } from "./firestore-admin.js";
import { gmailReady, sendMail, confirmedEmailText } from "./gmail-mailer.js";

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
      { type: "uri", label: "開啟預約日曆", uri: url }
    ]}
  };
}


function actionSecret(){ return process.env.BOOKING_SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || ""; }
function makeActionToken(payload){
  const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig=crypto.createHmac("sha256",actionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function ownerBookingFlex(b){
  const id=b.id;
  const uid=b.lineUserId || "";
  const token=makeActionToken({uid,id,ci:b.startDate,co:b.endDate,n:b.guestName,exp:Date.now()+7*24*60*60*1000});
  const nights=Math.max(1,Math.round((new Date(`${b.endDate}T00:00:00Z`)-new Date(`${b.startDate}T00:00:00Z`))/86400000));
  return {type:"flex",altText:`待確認預約 ${id}｜${b.startDate} → ${b.endDate}`,contents:{type:"bubble",size:"mega",
    header:{type:"box",layout:"vertical",backgroundColor:"#173A35",paddingAll:"18px",contents:[
      {type:"text",text:"LIJIE'S HOME",color:"#CDBD92",size:"xs",weight:"bold"},
      {type:"text",text:b.isTest?"俐姐的家｜TEST 測試預約":"俐姐的家｜待確認預約",color:"#FFFFFF",weight:"bold",size:"lg"},
      {type:"text",text:`編號 ${id}`,color:"#D7E4DF",size:"xs"}]},
    body:{type:"box",layout:"vertical",paddingAll:"18px",spacing:"sm",contents:[
      {type:"text",text:`${b.startDate} → ${b.endDate}`,weight:"bold",size:"xl",color:"#173A35",wrap:true},
      {type:"text",text:`${nights} 晚 · ${b.people?`${b.people} 人`:"人數未填"}`,size:"sm",color:"#7A8581"},
      ...(b.quotedTotal?[{type:"text",text:`系統試算｜NT$ ${Number(b.quotedTotal).toLocaleString("zh-TW")}`,size:"md",weight:"bold",color:"#8A6C2E",margin:"sm"}]:[]),
      {type:"text",text:Number(b.depositRequired)>0?`訂金｜NT$ ${Number(b.depositRequired).toLocaleString("zh-TW")}　已收 NT$ ${Number(b.paidAmount||0).toLocaleString("zh-TW")}`:"訂金｜NT$ 3,000",size:"sm",weight:"bold",color:Number(b.depositRequired)>0&&Number(b.paidAmount||0)>=Number(b.depositRequired)?"#1C6B59":"#9A6A2A",wrap:true,margin:"sm"},
      {type:"separator",margin:"md",color:"#E5E0D6"},
      {type:"text",text:`姓名｜${b.guestName||"未填"}
電話｜${b.phone||"未填"}
Email｜${b.email||"未填"}
需求｜${b.purpose||"未填"}
備註｜${b.notes||"沒有"}`,size:"sm",wrap:true,color:"#26332F",lineSpacing:"4px"}]},
    footer:{type:"box",layout:"vertical",paddingAll:"14px",spacing:"sm",contents:[
      {type:"button",style:"primary",color:"#173A35",action:{type:"postback",label:"確認預約",data:`booking_action=confirm&token=${encodeURIComponent(token)}`,displayText:`確認預約 ${id}`}}
    ]}}};
}
function verifyActionToken(token){
  const [body,sig,extra]=String(token||"").split(".");
  if(!body||!sig||extra) throw new Error("ACTION_TOKEN_INVALID");
  const expected=crypto.createHmac("sha256",actionSecret()).update(body).digest("base64url");
  const a=Buffer.from(sig), b=Buffer.from(expected);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) throw new Error("ACTION_TOKEN_INVALID");
  const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
  if(!payload?.uid||!payload?.id||!payload?.exp||Date.now()>Number(payload.exp)) throw new Error("ACTION_TOKEN_EXPIRED");
  return payload;
}
async function pushLine(to,messages,token){
  const normalized=(Array.isArray(messages)?messages:[messages]).map(m=>typeof m==="string"?{type:"text",text:m}:m);
  const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify({to,messages:normalized.slice(0,5)})});
  if(!r.ok) throw new Error(`LINE push failed: ${r.status} ${await r.text()}`);
}
function customerStatusFlex(p,status,actionToken){
  const confirmed=status==="confirm";
  const calendarUrl=confirmed && actionToken
    ? `https://www.5-1bbs.com/api/booking-calendar?token=${encodeURIComponent(actionToken)}`
    : null;
  return {type:"flex",altText:`俐姐的家｜${confirmed?"預約已確認":"預約已取消"}`,contents:{type:"bubble",size:"mega",
    header:{type:"box",layout:"vertical",paddingAll:"22px",spacing:"xs",backgroundColor:confirmed?"#153C36":"#6A4141",contents:[
      {type:"text",text:"LIJIE'S HOME",color:confirmed?"#CDBD92":"#E7CACA",size:"xs",weight:"bold"},
      {type:"text",text:"俐姐的家",color:"#FFFFFF",weight:"bold",size:"xxl"},
      {type:"text",text:confirmed?"預約已確認":"預約已取消",color:"#FFFFFF",size:"sm"}]},
    body:{type:"box",layout:"vertical",paddingAll:"22px",spacing:"md",contents:[
      {type:"text",text:confirmed?"住宿日期已為您保留":"本次預約已取消",size:"sm",color:"#7C8682"},
      {type:"text",text:`${p.ci}  →  ${p.co}`,weight:"bold",size:"xl",color:"#153C36",wrap:true},
      ...(p.total?[{type:"text",text:`住宿總額｜NT$ ${Number(p.total).toLocaleString("zh-TW")}`,weight:"bold",size:"md",color:"#8A6C2E",margin:"sm"}]:[]),
      {type:"separator",margin:"md",color:"#E5E0D6"},
      {type:"text",text:`預約編號｜${p.id}\n姓名｜${p.n||"未填"}`,size:"sm",wrap:true,color:"#394743",lineSpacing:"4px"},
      {type:"separator",margin:"md",color:"#E5E0D6"},
      {type:"text",text:confirmed?"訂金已確認入帳，您的預約已正式成立。尾款與住宿細節請依官方 LINE 後續通知。":"本次日期已釋出；若想重新安排，歡迎再次開啟預約日曆。",size:"sm",wrap:true,color:"#394743"}]},
    footer:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"sm",contents:[
      ...(confirmed&&calendarUrl?[{type:"button",style:"primary",color:"#153C36",height:"sm",action:{type:"uri",label:"加入行事曆",uri:calendarUrl}}]:[]),
      {type:"box",layout:"vertical",paddingAll:"11px",backgroundColor:confirmed?"#EAF4F0":"#F6ECEC",cornerRadius:"10px",contents:[
        {type:"text",text:confirmed?"● 已確認預約":"● 已取消預約",align:"center",weight:"bold",size:"sm",color:confirmed?"#1C6B59":"#8A4747"}
      ]}
    ]}}};
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
  if (/取消訂單|取消預約|取消訂房|我要取消|想取消|退訂|取消住宿/.test(t)) {
    return {
      text: [
        "【取消預約申請】",
        "可以的，請直接在這個聊天室回覆以下資料：",
        "",
        "1. 預約姓名",
        "2. 入住日期",
        "3. 聯絡電話末 3 碼",
        "4. 取消原因",
        "",
        "收到後會由俐姐核對訂單，再確認取消與訂金處理方式。",
        "⚠️ 傳送此訊息不代表訂單已自動取消；請以官方 LINE 最後確認結果為準。",
        "如已支付訂金，是否保留、退款或部分退款，會依該筆訂單約定與實際情況確認。"
      ].join("\n")
    };
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
        await replyLine(event.replyToken, [welcomeText(), bookingButtonMessage(bookingUrlFor(event.source?.userId, secret))], token);
        continue;
      }

      if (event.type === "postback") {
        const ownerId=String(process.env.LINE_BOOKING_NOTIFY_TO || "").trim();
        if(!ownerId || event.source?.userId !== ownerId){
          await replyLine(event.replyToken,"此操作僅限俐姐管理帳號使用。",token);
          continue;
        }
        const q=new URLSearchParams(event.postback?.data||"");
        const action=q.get("booking_action");
        if(action!=="confirm") continue;
        try{
          const payload=verifyActionToken(q.get("token"));
          if(!firestoreReady()) throw new Error("FIRESTORE_NOT_CONFIGURED");
          const current=await getBooking(payload.id);
          if(!current) throw new Error("BOOKING_NOT_FOUND");
          if(current.status === "confirmed" && action === "confirm"){
            await replyLine(event.replyToken,`這筆預約 ${payload.id} 已經確認過了。`,token); continue;
          }
          const depositRequired=Number(current.depositRequired||0);
          const paidAmount=Number(current.paidAmount||current.amountReceived||0);
          if(!(depositRequired>0)){
            await replyLine(event.replyToken,`這筆預約 ${payload.id} 尚未設定訂金金額。請先到後台設定訂金並登記收款，之後再回 LINE 按「確認預約」。`,token); continue;
          }
          if(paidAmount<depositRequired){
            await replyLine(event.replyToken,`這筆預約尚未收足訂金，不能確認。\n訂金：NT$ ${depositRequired.toLocaleString("zh-TW")}\n目前已收：NT$ ${paidAmount.toLocaleString("zh-TW")}\n尚差：NT$ ${(depositRequired-paidAmount).toLocaleString("zh-TW")}\n\n請先到後台新增收款紀錄。`,token); continue;
          }
          const nextStatus="confirmed";
          const updated=await setBookingStatus(payload.id,nextStatus);
          const statusPayload={id:payload.id,uid:updated.lineUserId||"",ci:updated.startDate,co:updated.endDate,n:updated.guestName,total:updated.quotedTotal||null,isTest:Boolean(updated.isTest)};
          let customerNotified=false, notifyError="";
          if(statusPayload.uid){
            try{
              const calendarToken=makeActionToken({...statusPayload,exp:Date.now()+30*24*60*60*1000});
              await pushLine(statusPayload.uid,customerStatusFlex(statusPayload,action,calendarToken),token);
              customerNotified=true;
            }catch(e){ notifyError=String(e?.message||e); console.warn("customer status push failed",e); }
          }
          let emailNotified=false;
          if(updated.email && gmailReady()){
            try{ await sendMail({to:updated.email,subject:updated.isTest?"俐姐的家｜【測試】預約流程已完成":"俐姐的家｜您的預約已確認",text:confirmedEmailText(updated)}); emailNotified=true; }
            catch(e){ console.warn("confirmed email failed",e); }
          }
          const adminText=[
            `✅ 已確認預約 ${payload.id}`,
            `${updated.startDate} → ${updated.endDate}`,
            `客人：${updated.guestName||"未填"}`,
            updated.isTest?"🧪 測試訂單：未鎖正式官網日期。":"官網日曆已鎖定。",
            updated.lineUserId ? (customerNotified ? "已通知客戶 LINE。" : "⚠️ 客戶 LINE Push 失敗，但預約已確認。") : "此筆為官網預約。",
            updated.email ? (emailNotified ? "已寄出確認 Email。" : "⚠️ 確認 Email 尚未寄出，請檢查 Gmail 設定。") : "客戶未填 Email。",
            "其餘取消、收款、支出與庫存請到後台操作。"
          ].join("\n");
          await replyLine(event.replyToken,adminText,token);
          if(notifyError) console.warn("booking action customer notify",{bookingId:payload.id,notifyError});
        }catch(e){
          console.error("booking action failed",e);
          const msg=String(e?.message||e);
          await replyLine(event.replyToken,msg.includes("BOOKING_DATE_CONFLICT")
            ? `⚠️ 無法確認：${msg.split(" ")[1] || "所選日期"} 已被另一筆已確認預約占用。請先查看後台日曆。`
            : msg.includes("FIRESTORE")
              ? "預約資料庫尚未完成伺服器設定，請先設定 FIREBASE_SERVICE_ACCOUNT_JSON。"
              : "這個預約操作無法完成，請傳『待確認預約』取得最新訂單卡片。",token);
        }
        continue;
      }

      if (event.type !== "message" || event.message?.type !== "text") continue;

      if (/^(管理者ID|我的LINEID|我的LINE ID)$/i.test(String(event.message.text||"").trim())) {
        await replyLine(event.replyToken, `你的 LINE userId：\n${event.source?.userId||"無法取得"}\n\n請把這個值放到 Vercel 的 LINE_BOOKING_NOTIFY_TO。`, token);
        continue;
      }

      const adminTextInput=String(event.message.text||"").trim();
      if (/^待確認預約$/.test(adminTextInput)) {
        const ownerId=String(process.env.LINE_BOOKING_NOTIFY_TO||"").trim();
        if(!ownerId || event.source?.userId!==ownerId){
          await replyLine(event.replyToken,"此指令僅限俐姐管理帳號使用。",token); continue;
        }
        try{
          const pending=await listPendingBookings(4);
          if(!pending.length){ await replyLine(event.replyToken,"目前沒有待確認預約。",token); continue; }
          const msgs=[{type:"text",text:`目前有 ${pending.length} 筆待確認預約。\n請直接在卡片下方按「確認預約」。取消、修改與帳務請到網站後台操作。`},...pending.map(ownerBookingFlex)];
          await replyLine(event.replyToken,msgs,token);
        }catch(e){
          console.error("pending bookings command failed",e);
          await replyLine(event.replyToken,"目前無法讀取待確認預約，請確認 Firestore 伺服器憑證設定。",token);
        }
        continue;
      }

      if (/^管理者測試$/.test(adminTextInput)) {
        const current=event.source?.userId||"";
        const ownerId=String(process.env.LINE_BOOKING_NOTIFY_TO||"").trim();
        const idMatch=Boolean(ownerId && current===ownerId);
        let botOk=false, botInfo="", pushOk=false, pushError="";
        try{
          const r=await fetch("https://api.line.me/v2/bot/info",{headers:{Authorization:`Bearer ${token}`}});
          botOk=r.ok;
          const j=await r.json().catch(()=>({}));
          botInfo=r.ok ? `${j.displayName||"未知官方帳號"} (${j.basicId||j.premiumId||"無ID"})` : `HTTP ${r.status}`;
        }catch(e){ botInfo=String(e?.message||e); }
        if(idMatch){
          try{ await pushLine(current,"✅ 俐姐的家管理者 Push 測試成功。",token); pushOk=true; }
          catch(e){ pushError=String(e?.message||e).slice(0,260); }
        }
        const db=await firestoreDiagnostic();
        const lines=[
          "【俐姐的家｜管理者測試】",
          `管理者 ID：${idMatch?"✅ 符合":"❌ 不符合"}`,
          `Messaging API Token：${botOk?"✅ 可用":"❌ 異常"}`,
          `官方帳號：${botInfo}`,
          `Push 測試：${idMatch?(pushOk?"✅ 成功":"❌ 失敗"):"未執行（ID 不符）"}`,
          `Firestore：${db.ready?(db.readOk?"✅ 可讀取":"⚠️ 已設定但讀取失敗"):"❌ 尚未設定"}`,
          db.projectId?`Firebase Project：${db.projectId}`:null,
          pushError?`Push 錯誤：${pushError}`:null,
          (!idMatch && ownerId)?`目前 userId：${current}\n設定的管理者：${ownerId}`:null
        ].filter(Boolean);
        await replyLine(event.replyToken,lines.join("\n"),token);
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
