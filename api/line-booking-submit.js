import crypto from "node:crypto";
import { COOKIE_NAME, parseCookies, verifyPayload as verifyCookieSession } from "./line-auth-lib.js";
import { BOOKING_RULES } from "../js/booking-rules.js";
import { putBooking, firestoreReady } from "./firestore-admin.js";

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
  return {checkIn:a.s,checkOut:b.s,nights,name,phone:clean(input.phone,40),people,purpose:clean(input.purpose,120),notes:clean(input.notes,500),source:clean(input.source,40)||"official-line-secure-link"};
}

function actionSecret(){ return process.env.BOOKING_SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || ""; }
function makeActionToken(payload){
  const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig=crypto.createHmac("sha256", actionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function bookingId(){ return `B${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`; }
function ownerFlex(b, uid, id){
  const token=makeActionToken({uid,id,ci:b.checkIn,co:b.checkOut,n:b.name,exp:Date.now()+7*24*60*60*1000});
  return {type:"flex",altText:`新預約 ${id}｜${b.checkIn} → ${b.checkOut}`,contents:{type:"bubble",size:"mega",
    header:{type:"box",layout:"vertical",backgroundColor:"#173A35",paddingAll:"18px",contents:[
      {type:"text",text:"俐姐的家｜新預約申請",color:"#FFFFFF",weight:"bold",size:"lg"},
      {type:"text",text:`編號 ${id}`,color:"#D7E4DF",size:"xs"}]},
    body:{type:"box",layout:"vertical",paddingAll:"18px",spacing:"sm",contents:[
      {type:"text",text:`${b.checkIn} → ${b.checkOut}（${b.nights} 晚）`,weight:"bold",size:"lg",color:"#173A35",wrap:true},
      {type:"text",text:`姓名｜${b.name}\n電話｜${b.phone||"未填"}\n人數｜${b.people?b.people+" 人":"未填"}\n需求｜${b.purpose||"未填"}\n備註｜${b.notes||"沒有"}`,size:"sm",wrap:true,color:"#26332F"}]},
    footer:{type:"box",layout:"vertical",paddingAll:"14px",spacing:"sm",contents:[
      {type:"button",style:"primary",color:"#173A35",action:{type:"postback",label:"確認預約",data:`booking_action=confirm&token=${encodeURIComponent(token)}`,displayText:`確認預約 ${id}`}},
      {type:"button",style:"secondary",action:{type:"postback",label:"取消預約",data:`booking_action=cancel&token=${encodeURIComponent(token)}`,displayText:`取消預約 ${id}`}}]}}};
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
        {type:"text",text:"LIJIE'S HOME",color:"#CDBD92",size:"xs",weight:"bold",letterSpacing:"1px"},
        {type:"text",text:"俐姐的家",color:"#FFFFFF",weight:"bold",size:"xxl"},
        {type:"text",text:"預約申請已收到",color:"#D9E5E1",size:"sm"}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"22px",spacing:"md",contents:[
        {type:"box",layout:"horizontal",spacing:"sm",contents:[
          {type:"box",layout:"vertical",flex:1,paddingAll:"12px",backgroundColor:"#F7F3EA",cornerRadius:"10px",contents:[
            {type:"text",text:"入住",size:"xs",color:"#8B7E61"},
            {type:"text",text:b.checkIn,size:"lg",weight:"bold",color:"#153C36",margin:"xs"},
            {type:"text",text:BOOKING_RULES.checkInFrom,size:"xs",color:"#6F7773",margin:"xs"}
          ]},
          {type:"box",layout:"vertical",flex:1,paddingAll:"12px",backgroundColor:"#F7F3EA",cornerRadius:"10px",contents:[
            {type:"text",text:"退房",size:"xs",color:"#8B7E61"},
            {type:"text",text:b.checkOut,size:"lg",weight:"bold",color:"#153C36",margin:"xs"},
            {type:"text",text:BOOKING_RULES.checkOutBy,size:"xs",color:"#6F7773",margin:"xs"}
          ]}
        ]},
        {type:"text",text:`${b.nights} 晚  ·  ${b.people?`${b.people} 人`:"人數未填"}`,size:"sm",weight:"bold",color:"#6B756F",align:"center"},
        {type:"separator",margin:"md",color:"#E5E0D6"},
        infoRow("姓名",b.name),
        infoRow("電話",b.phone||"未填"),
        infoRow("需求",b.purpose||"未填"),
        infoRow("備註",b.notes||"沒有"),
        {type:"separator",margin:"md",color:"#E5E0D6"},
        {type:"text",text:"入住提醒",weight:"bold",size:"md",color:"#153C36",margin:"sm"},
        {type:"text",text:`訂金需先轉帳；尾款可轉帳或現金。\n整棟最多入住 ${BOOKING_RULES.maxGuests} 人。`,size:"sm",color:"#48534F",wrap:true,lineSpacing:"4px"},
        {type:"text",text:"此為預約申請，實際成立仍以俐姐於官方 LINE 最終確認為準。",size:"xs",color:"#8B938F",wrap:true}
      ]},
      footer:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"sm",contents:[
        {type:"box",layout:"vertical",paddingAll:"12px",backgroundColor:"#FFF3CC",cornerRadius:"10px",contents:[
          {type:"text",text:"● 等待俐姐確認",align:"center",weight:"bold",size:"sm",color:"#8A6500"}
        ]}
      ]}
    }
  };
  const text={type:"text",text:["【俐姐的家｜預約申請】",`入住：${b.checkIn}`,`退房：${b.checkOut}（${b.nights} 晚）`,`姓名：${b.name}`,`電話：${b.phone||"未填"}`,`人數：${b.people?`${b.people} 人`:"未填"}`,`需求：${b.purpose||"未填"}`,`備註：${b.notes||"沒有"}`,"","預約資料已送達，請等待俐姐確認日期與訂金安排。"].join("\n")};
  return [text,flex];
}

async function push(to,msgs,token){
  const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify({to,messages:msgs})});
  if(!r.ok){ const t=await r.text(); const e=new Error(`LINE_PUSH_FAILED ${r.status} ${t}`); e.code="LINE_PUSH_FAILED"; throw e; }
}
export default async function handler(req,res){
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({ok:false,error:"Method Not Allowed"});}
  const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const explicit = clean(body.session,4000);
    const resolvedSession = resolveSession(req, explicit);
    const session = resolvedSession.payload;
    const booking=normalizeBooking(body.booking);
    const id=bookingId();
    console.log("booking-secure-submit",{userId:String(session.uid).slice(0,8)+"…",sessionSource:resolvedSession.source,checkIn:booking.checkIn,checkOut:booking.checkOut,people:booking.people});

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
      people:booking.people,
      purpose:booking.purpose,
      notes:booking.notes,
      deposit:"待確認",
      status:"pending",
      lineUserId:String(session.uid),
      source:booking.source,
      createdAt:now,
      updatedAt:now
    });
    console.log("booking-firestore-saved",{bookingId:id});

    const notifyTo=String(process.env.LINE_BOOKING_NOTIFY_TO||"").trim();
    const customerMessages=messages(booking);
    let customerDelivered=false;
    let ownerDelivered=false;
    let customerError="";
    let ownerError="";

    // 先確保管理者一定收到管理卡。就算 LINE Login 取得的 userId 與
    // Messaging API 所屬 Provider 不一致，管理者仍可看到「確認／取消」按鈕。
    if(notifyTo && token){
      try{
        if(notifyTo===session.uid){
          await push(notifyTo,[...customerMessages,ownerFlex(booking,session.uid,id)],token);
          customerDelivered=true;
          ownerDelivered=true;
          console.log("booking-owner-self-test",{bookingId:id});
        }else{
          await push(notifyTo,[ownerFlex(booking,session.uid,id)],token);
          ownerDelivered=true;
        }
      }catch(e){
        ownerError=String(e?.message||e);
        console.warn("owner notify failed",e);
      }
    }else{
      if(!notifyTo) console.warn("LINE_BOOKING_NOTIFY_TO not configured; owner card skipped");
      if(!token) console.warn("LINE_CHANNEL_ACCESS_TOKEN not configured; LINE push skipped");
    }

    if(!customerDelivered && token){
      try{
        await push(session.uid,customerMessages,token);
        customerDelivered=true;
      }catch(e){
        customerError=String(e?.message||e);
        console.warn("customer push failed",e);
      }
    }

    console.log("booking-secure-delivery",{bookingId:id,customerDelivered,ownerDelivered,checkIn:booking.checkIn,checkOut:booking.checkOut});

    // 只要 Firestore 已成功存檔，就回傳預約成功。
    // LINE 主動 Push 是通知層，不再決定預約是否成立為「待確認」。
    return res.status(200).json({
      ok:true,
      saved:true,
      bookingId:id,
      customerDelivered,
      ownerDelivered,
      warning: (!customerDelivered || !ownerDelivered) ? "LINE_NOTIFICATION_PARTIAL" : null,
      sessionSource: resolvedSession.source,
      diagnostic: (!customerDelivered || !ownerDelivered)
        ? "預約已安全存入 Firestore。若管理通知未收到，請在官方 LINE 傳『待確認預約』；若要檢查 Push，請傳『管理者測試』。"
        : null
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
