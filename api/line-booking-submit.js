import crypto from "node:crypto";
import { COOKIE_NAME, parseCookies, verifyPayload as verifyCookieSession } from "./line-auth-lib.js";
import { BOOKING_RULES } from "../js/booking-rules.js";
import { putBooking, firestoreReady, quoteStay, getPublicPricingSettings } from "./firestore-admin.js";
import { gmailReady, sendMail, receivedEmailText } from "./gmail-mailer.js";

function clean(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}
function b64url(input) { return Buffer.from(input).toString("base64url"); }
function safeEqual(a,b){
  try { const x=Buffer.from(a); const y=Buffer.from(b); return x.length===y.length && crypto.timingSafeEqual(x,y); }
  catch { return false; }
}
function verifySessionWithSecrets(token, secrets=[]){
  if (!token) throw new Error("BOOKING_SESSION_REQUIRED");
  const parts=String(token).split(".");
  if(parts.length!==2) throw new Error("BOOKING_SESSION_INVALID");
  const [payloadPart,sig]=parts;
  const candidates=[...new Set(secrets.map(v=>String(v||"").trim()).filter(Boolean))];
  if(!candidates.length) throw new Error("BOOKING_SESSION_REQUIRED");
  const matched=candidates.some(secret=>{
    const expected=crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
    return safeEqual(sig,expected);
  });
  if(!matched) throw new Error("BOOKING_SESSION_INVALID");
  let payload;
  try { payload=JSON.parse(Buffer.from(payloadPart,"base64url").toString("utf8")); }
  catch { throw new Error("BOOKING_SESSION_INVALID"); }
  if(!payload?.uid || !payload?.exp) throw new Error("BOOKING_SESSION_INVALID");
  if(Date.now()>Number(payload.exp)) throw new Error("BOOKING_SESSION_EXPIRED");
  return payload;
}

function resolveSession(req, explicit){
  const cookieSession=parseCookies(req)[COOKIE_NAME] || "";
  // LINE Login cookie is the preferred identity. This avoids an old ?session= query
  // overriding a newer, valid login cookie after the user has authenticated.
  if(cookieSession){
    try { return {payload:verifyCookieSession(cookieSession), source:"line-login-cookie"}; }
    catch(e){ console.warn("booking cookie session invalid", String(e?.message||e)); }
  }
  if(explicit){
    const payload=verifySessionWithSecrets(explicit,[process.env.BOOKING_SESSION_SECRET,process.env.LINE_CHANNEL_SECRET]);
    return {payload, source:"secure-link"};
  }
  throw new Error("BOOKING_SESSION_REQUIRED");
}
function parseDateKey(v){
  const s=clean(v,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y,m,d]=s.split("-").map(Number); const date=new Date(Date.UTC(y,m-1,d));
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d) return null;
  return {s,date};
}
function normalizeBooking(input={}){
  const a=parseDateKey(input.checkIn), b=parseDateKey(input.checkOut);
  if(!a||!b||b.date<=a.date) throw new Error("INVALID_DATES");
  const nights=Math.round((b.date-a.date)/86400000); if(nights<1||nights>30) throw new Error("INVALID_NIGHTS");
  const peopleRaw=Number.parseInt(String(input.people??""),10);
  const people=Number.isFinite(peopleRaw)?Math.min(Math.max(peopleRaw,1),12):null;
  const name=clean(input.name,60); if(!name) throw new Error("NAME_REQUIRED");
  const email=clean(input.email,120).toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("EMAIL_REQUIRED");
  return {checkIn:a.s,checkOut:b.s,nights,name,phone:clean(input.phone,40),email,people,purpose:clean(input.purpose,120),notes:clean(input.notes,500),source:clean(input.source,40)||"official-line-secure-link"};
}

function messages(b){
  const infoRow=(label,value)=>({
    type:"box",layout:"baseline",spacing:"sm",contents:[
      {type:"text",text:label,size:"xs",color:"#8B938F",flex:2},
      {type:"text",text:String(value||"未填"),size:"sm",color:"#1E2D29",weight:"bold",flex:5,wrap:true}
    ]
  });
  const flex={
    type:"flex",
    altText:`俐姐的家｜預約申請已收到 ${b.checkIn} → ${b.checkOut}`,
    contents:{type:"bubble",size:"mega",
      header:{type:"box",layout:"vertical",paddingAll:"22px",spacing:"xs",backgroundColor:"#153C36",contents:[
        {type:"text",text:"LIJIE'S HOME",color:"#CDBD92",size:"xs",weight:"bold"},
        {type:"text",text:"俐姐的家",color:"#FFFFFF",weight:"bold",size:"xxl"},
        {type:"text",text:"預約申請已收到",color:"#D9E5E1",size:"sm"}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"22px",spacing:"md",contents:[
        {type:"box",layout:"vertical",spacing:"sm",contents:[
          {type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F7F3EA",cornerRadius:"12px",contents:[
            {type:"text",text:"📅 入住日期",size:"xs",color:"#8B7E61",weight:"bold"},
            {type:"text",text:b.checkIn,size:"xl",weight:"bold",color:"#153C36",margin:"xs",wrap:true},
            {type:"text",text:`🕒 ${BOOKING_RULES.checkInFrom} 起`,size:"xs",color:"#6F7773",margin:"xs"}
          ]},
          {type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F7F3EA",cornerRadius:"12px",contents:[
            {type:"text",text:"🌙 退房日期",size:"xs",color:"#8B7E61",weight:"bold"},
            {type:"text",text:b.checkOut,size:"xl",weight:"bold",color:"#153C36",margin:"xs",wrap:true},
            {type:"text",text:`🕛 ${BOOKING_RULES.checkOutBy} 前`,size:"xs",color:"#6F7773",margin:"xs"}
          ]}
        ]},
        {type:"text",text:`✨ ${b.nights} 晚  ·  ${b.people?`${b.people} 人`:"人數未填"}`,size:"sm",weight:"bold",color:"#6B756F",align:"center"},
        ...(b.quotedTotal?[{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F2EEE2",cornerRadius:"12px",contents:[
          {type:"text",text:"本次日期住宿試算",size:"xs",color:"#8B7E61",weight:"bold",align:"center"},
          {type:"text",text:`NT$ ${Number(b.quotedTotal).toLocaleString("zh-TW")}`,size:"xxl",color:"#153C36",weight:"bold",align:"center",margin:"xs"},
          {type:"text",text:"依目前後台價格規則試算，最終金額以俐姐確認為準。",size:"xxs",color:"#7A8581",wrap:true,align:"center",margin:"xs"}
        ]}]:[]),
        {type:"separator",margin:"md",color:"#E5E0D6"},
        infoRow("姓名",b.name),
        infoRow("電話",b.phone||"未填"),
        infoRow("需求",b.purpose||"未填"),
        infoRow("備註",b.notes||"沒有"),
        {type:"separator",margin:"md",color:"#E5E0D6"},
        {type:"text",text:"🌿 入住提醒",weight:"bold",size:"md",color:"#153C36",margin:"sm"},
        {type:"text",text:`固定訂金 NT$${Number(BOOKING_RULES.payment.depositAmount||3000).toLocaleString("zh-TW")}，需先轉帳；尾款可轉帳或現金。\n整棟最多入住 ${BOOKING_RULES.maxGuests} 人。`,size:"sm",color:"#48534F",wrap:true,lineSpacing:"4px"},
        {type:"text",text:"此為預約申請，實際成立仍以俐姐於官方 LINE 最終確認為準。",size:"xs",color:"#8B938F",wrap:true}
      ]},
      footer:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"sm",contents:[
        {type:"box",layout:"vertical",paddingAll:"12px",backgroundColor:"#FFF3CC",cornerRadius:"10px",contents:[
          {type:"text",text:"🟡 等待俐姐確認",align:"center",weight:"bold",size:"sm",color:"#8A6500"}
        ]}
      ]}
    }
  };
  const text={type:"text",text:["【俐姐的家｜預約申請】",`入住：${b.checkIn}`,`退房：${b.checkOut}（${b.nights} 晚）`,`姓名：${b.name}`,`電話：${b.phone||"未填"}`,`人數：${b.people?`${b.people} 人`:"未填"}`,`需求：${b.purpose||"未填"}`,`備註：${b.notes||"沒有"}`,...(b.quotedTotal?[`試算金額：NT$ ${Number(b.quotedTotal).toLocaleString("zh-TW")}`]:[]),"",`預約資料已送達；固定訂金 NT$${Number(BOOKING_RULES.payment.depositAmount||3000).toLocaleString("zh-TW")}。訂金入帳且俐姐於官方 LINE 確認後，預約才正式成立。`].join("\n")};
  return [text,flex];
}

async function push(to,msgs,token,meta={}){
  const started=Date.now();
  const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify({to,messages:msgs})});
  const text=await r.text();
  const diag={...meta,httpStatus:r.status,ok:r.ok,durationMs:Date.now()-started,response:text.slice(0,600),toPrefix:String(to||"").slice(0,10),messageTypes:(msgs||[]).map(m=>m?.type||typeof m)};
  console.log(r.ok?"booking-push-success":"booking-push-error",diag);
  if(!r.ok){ const e=new Error(`LINE_PUSH_FAILED ${r.status} ${text}`); e.code="LINE_PUSH_FAILED"; e.httpStatus=r.status; e.response=text; throw e; }
  return diag;
}
export default async function handler(req,res){
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({ok:false,error:"Method Not Allowed"});}
  const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();
  try{
    const requestId=String(req.headers["x-vercel-id"]||req.headers["x-request-id"]||crypto.randomUUID());
    const diag=(stage,data={})=>console.log("booking-submit-diag",{requestId,stage,...data});
    diag("START",{method:req.method,host:req.headers.host||"",hasCookie:Boolean(req.headers.cookie),hasToken:Boolean(token),firestoreReady:firestoreReady()});
    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const explicit = clean(body.session,4000);
    const resolvedSession = resolveSession(req, explicit);
    const session = resolvedSession.payload;
    const booking=normalizeBooking(body.booking);
    const pricingSettings=await getPublicPricingSettings();
    const todayKey=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"});
    if(booking.checkIn < todayKey || booking.checkOut > pricingSettings.maxBookableDate){
      const e=new Error("BOOKING_OUTSIDE_WINDOW"); e.code="BOOKING_OUTSIDE_WINDOW"; throw e;
    }
    const quote=await quoteStay(booking.checkIn,booking.checkOut);
    if(quote){ booking.quotedTotal=quote.total; booking.quoteBreakdown=quote.details; booking.pricingUpdatedAt=quote.pricingUpdatedAt||null; }
    const id=bookingId();
    diag("AUTH_OK",{bookingId:id,userIdPrefix:String(session.uid).slice(0,10),sessionSource:resolvedSession.source});
    diag("BOOKING_VALID",{bookingId:id,checkIn:booking.checkIn,checkOut:booking.checkOut,nights:booking.nights,people:booking.people,source:booking.source});
    console.log("booking-secure-submit",{bookingId:id,userId:String(session.uid).slice(0,8)+"…",sessionSource:resolvedSession.source,checkIn:booking.checkIn,checkOut:booking.checkOut,people:booking.people});

    // 先把預約寫進 Firestore。之後 LINE Push 就算暫時失敗，訂單也不會遺失。
    if(!firestoreReady()){
      const e=new Error("FIRESTORE_NOT_CONFIGURED"); e.code="FIRESTORE_NOT_CONFIGURED"; throw e;
    }
    const now=new Date().toISOString();
    await putBooking(id,{
      startDate:booking.checkIn,
      endDate:booking.checkOut,
      guestName:booking.name,
      phone:booking.phone,
      email:booking.email||"",
      people:booking.people,
      purpose:booking.purpose,
      notes:booking.notes,
      deposit:"NT$ 3,000",
      depositRequired:3000,
      paidAmount:0,
      financeStatus:"待收訂金",
      status:"pending",
      lineUserId:String(session.uid),
      source:booking.source,
      quotedTotal:booking.quotedTotal||null,
      totalAmount:booking.quotedTotal||0,
      paidAmount:0,
      balanceAmount:booking.quotedTotal||0,
      financeStatus:"待收訂金",
      quoteBreakdown:booking.quoteBreakdown||[],
      pricingUpdatedAt:booking.pricingUpdatedAt||null,
      createdAt:now,
      updatedAt:now
    });
    console.log("booking-firestore-saved",{bookingId:id});
    diag("FIRESTORE_SAVED",{bookingId:id});
    if(booking.email && gmailReady()){
      try{ await sendMail({to:booking.email,subject:"俐姐的家｜已收到您的預約需求",text:receivedEmailText({id,guestName:booking.name,startDate:booking.checkIn,endDate:booking.checkOut,people:booking.people})}); }
      catch(e){ console.warn("booking received email failed",e); }
    }

    const customerMessages=messages(booking);
    let customerDelivered=false;
    let customerError="";
    if(token){
      try{
        diag("CUSTOMER_PUSH_START",{bookingId:id,userIdPrefix:String(session.uid).slice(0,10)});
        await push(session.uid,customerMessages,token,{requestId,stage:"CUSTOMER",bookingId:id});
        customerDelivered=true;
        diag("CUSTOMER_PUSH_SUCCESS",{bookingId:id});
      }catch(e){
        customerError=String(e?.message||e);
        diag("CUSTOMER_PUSH_ERROR",{bookingId:id,error:customerError.slice(0,800),httpStatus:e?.httpStatus||null});
        console.warn("customer push failed",e);
      }
    }
    diag("COMPLETE",{bookingId:id,customerDelivered,customerError:customerError.slice(0,300)});

    // 只要 Firestore 已成功存檔，就回傳預約成功。
    // LINE 主動 Push 是通知層，不再決定預約是否成立為「待確認」。
    return res.status(200).json({
      ok:true,
      saved:true,
      bookingId:id,
      customerDelivered,
      warning: !customerDelivered ? "LINE_NOTIFICATION_PARTIAL" : null,
      sessionSource: resolvedSession.source,
      diagnostic: !customerDelivered ? "預約已安全存入 Firestore；客戶 LINE 通知暫時失敗。" : null,
      delivery:{customerDelivered,customerError:customerError?customerError.slice(0,240):null}
    });
  }catch(e){
    console.error("booking secure submit error",e);
    const code=String(e?.message||"UNKNOWN_ERROR");
    if(e?.code==="FIRESTORE_NOT_CONFIGURED" || code.includes("FIRESTORE_")){
      return res.status(503).json({ok:false,code:"FIRESTORE_SAVE_FAILED",error:"預約資料庫尚未完成伺服器設定，請確認 FIREBASE_SERVICE_ACCOUNT_JSON。"});
    }
    const status=code.includes("SESSION")?401:400;
    return res.status(status).json({ok:false,code,error:code});
  }
}
