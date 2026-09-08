import crypto from "node:crypto";
import { COOKIE_NAME, parseCookies, verifyPayload as verifyCookieSession } from "./line-auth-lib.js";
import { BOOKING_RULES } from "../js/booking-rules.js";

function clean(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}
function b64url(input) { return Buffer.from(input).toString("base64url"); }
function safeEqual(a,b){
  try { const x=Buffer.from(a); const y=Buffer.from(b); return x.length===y.length && crypto.timingSafeEqual(x,y); }
  catch { return false; }
}
function verifySession(token, secret){
  if (!token || !secret) throw new Error("BOOKING_SESSION_REQUIRED");
  const parts=String(token).split(".");
  if(parts.length!==2) throw new Error("BOOKING_SESSION_INVALID");
  const [payloadPart,sig]=parts;
  const expected=crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
  if(!safeEqual(sig,expected)) throw new Error("BOOKING_SESSION_INVALID");
  let payload;
  try { payload=JSON.parse(Buffer.from(payloadPart,"base64url").toString("utf8")); }
  catch { throw new Error("BOOKING_SESSION_INVALID"); }
  if(!payload?.uid || !payload?.exp) throw new Error("BOOKING_SESSION_INVALID");
  if(Date.now()>Number(payload.exp)) throw new Error("BOOKING_SESSION_EXPIRED");
  return payload;
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
function messages(b){
  const flex={
    type:"flex",altText:`俐姐的家｜預約申請已收到 ${b.checkIn} → ${b.checkOut}`,
    contents:{type:"bubble",size:"mega",
      header:{type:"box",layout:"vertical",paddingAll:"20px",spacing:"xs",backgroundColor:"#173A35",contents:[
        {type:"text",text:"俐姐的家",color:"#FFFFFF",weight:"bold",size:"xl"},
        {type:"text",text:"預約申請已收到",color:"#D7E4DF",size:"sm"}]},
      body:{type:"box",layout:"vertical",paddingAll:"20px",spacing:"md",contents:[
        {type:"text",text:`${b.checkIn}  →  ${b.checkOut}`,weight:"bold",size:"xl",color:"#173A35",wrap:true},
        {type:"text",text:`${b.nights} 晚｜${b.people?`${b.people} 人`:"人數未填"}`,size:"sm",color:"#6C7773"},
        {type:"separator",margin:"md"},
        {type:"text",text:`姓名｜${b.name}\n電話｜${b.phone||"未填"}\n需求｜${b.purpose||"未填"}\n備註｜${b.notes||"沒有"}`,size:"sm",color:"#1F2E2B",wrap:true,margin:"md"},
        {type:"separator",margin:"md"},
        {type:"text",text:"入住須知",weight:"bold",size:"md",color:"#173A35",margin:"md"},
        {type:"text",text:`入住 ${BOOKING_RULES.checkInFrom} 起｜退房 ${BOOKING_RULES.checkOutBy} 前`,size:"sm",color:"#202725",wrap:true},
        {type:"text",text:`${BOOKING_RULES.payment.depositMethod}；${BOOKING_RULES.payment.balanceMethods}。`,size:"sm",color:"#202725",wrap:true},
        {type:"text",text:"整棟最多入住 12 人；目前為預約申請，實際成立以官方 LINE 最終確認為準。",size:"xs",color:"#6B7773",wrap:true}]},
      footer:{type:"box",layout:"vertical",paddingAll:"16px",contents:[{type:"box",layout:"vertical",paddingAll:"12px",backgroundColor:"#FFF7DF",cornerRadius:"8px",contents:[{type:"text",text:"🟡 等待俐姐確認",align:"center",weight:"bold",size:"sm",color:"#8A6400"}]}]}}
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
  const token=process.env.LINE_CHANNEL_ACCESS_TOKEN, secret=process.env.LINE_CHANNEL_SECRET;
  if(!token||!secret) return res.status(500).json({ok:false,error:"LINE environment variables are not configured"});
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const explicit = clean(body.session,4000);
    const cookieSession = parseCookies(req)[COOKIE_NAME] || "";
    const session = explicit ? verifySession(explicit, secret) : verifyCookieSession(cookieSession);
    const booking=normalizeBooking(body.booking);
    console.log("booking-secure-submit",{userId:String(session.uid).slice(0,8)+"…",checkIn:booking.checkIn,checkOut:booking.checkOut,people:booking.people});
    await push(session.uid,messages(booking),token);
    const notifyTo=process.env.LINE_BOOKING_NOTIFY_TO;
    if(notifyTo&&notifyTo!==session.uid){
      try{await push(notifyTo,[{type:"text",text:`【新預約申請】\n${booking.name}\n${booking.checkIn} → ${booking.checkOut}（${booking.nights} 晚）\n${booking.people?booking.people+" 人":"人數未填"}\n${booking.phone||"電話未填"}`}],token);}catch(e){console.warn("owner notify failed",e);}
    }
    console.log("booking-secure-push-success",{checkIn:booking.checkIn,checkOut:booking.checkOut});
    return res.status(200).json({ok:true});
  }catch(e){
    console.error("booking secure submit error",e);
    const code=String(e?.message||"UNKNOWN_ERROR");
    if(e?.code==="LINE_PUSH_FAILED") return res.status(409).json({ok:false,code:"LINE_PUSH_FAILED",error:"Official LINE cannot message this user"});
    const status=code.includes("SESSION")?401:400;
    return res.status(status).json({ok:false,code,error:code});
  }
}
