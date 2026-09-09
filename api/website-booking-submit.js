import crypto from "node:crypto";
import {putBooking,firestoreReady,quoteStay,getPublicPricingSettings} from "./firestore-admin.js";
import {gmailReady,sendMail,receivedEmailText} from "./gmail-mailer.js";
function c(v,m=500){return String(v??"").replace(/[\u0000-\u001F\u007F]/g," ").trim().slice(0,m)}
function validDate(v){const s=c(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null}
function bid(){return`W${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`}
function secret(){return process.env.BOOKING_SESSION_SECRET||process.env.LINE_CHANNEL_SECRET||""}
function act(p){const b=Buffer.from(JSON.stringify(p)).toString("base64url"),s=crypto.createHmac("sha256",secret()).update(b).digest("base64url");return`${b}.${s}`}
function flex(b){const t=act({id:b.id,uid:"website",ci:b.startDate,co:b.endDate,n:b.guestName,exp:Date.now()+604800000});return{type:"flex",altText:`新官網預約 ${b.id}`,contents:{type:"bubble",size:"mega",header:{type:"box",layout:"vertical",backgroundColor:"#173A35",paddingAll:"18px",contents:[{type:"text",text:b.isTest?"俐姐的家｜TEST 官網預約":"俐姐的家｜官網預約申請",color:"#FFFFFF",weight:"bold",size:"lg"},{type:"text",text:`編號 ${b.id}`,color:"#D7E4DF",size:"xs"}]},body:{type:"box",layout:"vertical",paddingAll:"18px",spacing:"sm",contents:[{type:"text",text:`${b.startDate} → ${b.endDate}`,weight:"bold",size:"xl",color:"#173A35"},{type:"text",text:`姓名｜${b.guestName}\n電話｜${b.phone||"未填"}\nEmail｜${b.email}\n人數｜${b.people} 人`,size:"sm",wrap:true,color:"#26332F"}]},footer:{type:"box",layout:"vertical",paddingAll:"14px",spacing:"sm",contents:[{type:"button",style:"primary",color:"#173A35",action:{type:"postback",label:"確認預約",data:`booking_action=confirm&token=${encodeURIComponent(t)}`,displayText:`確認預約 ${b.id}`}},{type:"button",style:"link",height:"sm",action:{type:"uri",label:"開啟後台",uri:`https://www.5-1bbs.com/admin/?tab=operations&booking=${encodeURIComponent(b.id)}`}}]}}}}
async function notify(m){const to=String(process.env.LINE_BOOKING_NOTIFY_TO||"").trim(),tok=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();if(!to||!tok)return false;const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${tok}`},body:JSON.stringify({to,messages:[m]})});if(!r.ok)throw new Error(`LINE_PUSH ${r.status}`);return true}
function publicError(code){
  const map={
    INVALID_JSON:"送出的資料格式有誤，請重新整理頁面後再試。",
    FORM_REJECTED:"送出被安全檢查阻擋，請重新整理頁面後再試。",
    INVALID_DATES:"入住／退房日期不正確，請重新選擇日期。",
    NAME_REQUIRED:"請填寫預約姓名。",
    EMAIL_REQUIRED:"Email 格式不正確，請確認後再送出。",
    FIRESTORE_NOT_CONFIGURED:"伺服器尚未完成 Firebase 設定。",
    BOOKING_OUTSIDE_WINDOW:"所選日期目前不在開放預約範圍內。"
  };
  if(String(code||"").startsWith("FIRESTORE_BOOKING_SAVE_FAILED")) return "預約資料暫時無法寫入，請稍後再試。";
  return map[code]||"預約送出失敗，請稍後再試。";
}
export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
  let isTest=false;
  try{
    let x;
    try{x=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});}catch{throw new Error("INVALID_JSON");}
    isTest=x.testMode===true;
    if(c(x.companyUrlDoNotFill||x.website,40)) throw new Error("FORM_REJECTED");
    const startDate=validDate(x.checkIn),endDate=validDate(x.checkOut),guestName=c(x.name,60),phone=c(x.phone,40),email=c(x.email,120).toLowerCase(),people=Math.min(12,Math.max(1,Number(x.people)||1));
    if(!startDate||!endDate||endDate<=startDate) throw new Error("INVALID_DATES");
    if(!guestName) throw new Error("NAME_REQUIRED");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("EMAIL_REQUIRED");
    if(!firestoreReady()) throw new Error("FIRESTORE_NOT_CONFIGURED");
    const settings=await getPublicPricingSettings(),today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"});
    if(startDate<today||endDate>settings.maxBookableDate) throw new Error("BOOKING_OUTSIDE_WINDOW");
    const q=await quoteStay(startDate,endDate),id=`${isTest?"TEST-":""}${bid()}`,now=new Date().toISOString(),data={id,startDate,endDate,guestName,phone,email,people,status:"pending",source:"website-desktop",quotedTotal:q?.total||null,quoteBreakdown:q?.details||[],totalAmount:q?.total||0,depositRequired:3000,paidAmount:0,balanceAmount:Math.max(0,(q?.total||0)-0),financeStatus:"待收訂金",isTest,testCreatedAt:isTest?now:null,createdAt:now,updatedAt:now};
    await putBooking(id,data);
    let lineNotified=false,emailSent=false;
    try{lineNotified=await notify(flex(data))}catch(e){console.warn("website booking LINE notify failed",String(e?.message||e))}
    if(gmailReady()) try{await sendMail({to:email,subject:isTest?"俐姐的家｜【測試】已收到您的預約需求":"俐姐的家｜已收到您的預約需求",text:receivedEmailText(data)});emailSent=true}catch(e){console.warn("website booking email failed",String(e?.message||e))}
    console.info("website-booking-submit OK",{bookingId:id,isTest,startDate,endDate,people});
    return res.status(200).json({ok:true,bookingId:id,lineNotified,emailSent,isTest});
  }catch(e){
    const code=String(e?.message||e||"UNKNOWN_ERROR");
    console.error("website-booking-submit FAILED",{code,isTest});
    return res.status(400).json({ok:false,error:code,message:publicError(code),debug:isTest?code:undefined});
  }
}
