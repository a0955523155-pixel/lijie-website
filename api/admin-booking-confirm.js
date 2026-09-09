import { requireAdmin } from "./admin-auth.js";
import { getBooking, setBookingStatus } from "./firestore-admin.js";
import { gmailReady, sendMail, confirmedEmailText, confirmedEmailHtml } from "./gmail-mailer.js";
function customerLineText(b){return `✅ 俐姐的家｜預約已確認\n預約編號：${b.id}\n入住：${b.startDate}\n退房：${b.endDate}\n人數：${b.people||"—"} 人\n\n訂金 NT$3,000 已確認入帳，預約正式成立。`;}
async function pushLine(to,text){const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();if(!to||!token)return false;const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({to,messages:[{type:"text",text}]})});if(!r.ok)throw new Error(`LINE_PUSH_FAILED ${r.status}`);return true;}
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
  try{
    const admin=await requireAdmin(req); const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{}); const id=String(body.bookingId||"").trim();
    if(!id)throw new Error("BOOKING_ID_REQUIRED"); const current=await getBooking(id); if(!current)throw new Error("BOOKING_NOT_FOUND");
    if(current.status==="cancelled")throw new Error("BOOKING_CANCELLED"); if(current.status==="confirmed")return res.status(200).json({ok:true,alreadyConfirmed:true});
    const dep=Number(current.depositRequired||3000),paid=Number(current.paidAmount||current.amountReceived||0); if(paid<dep)throw new Error("DEPOSIT_NOT_PAID");
    const updated=await setBookingStatus(id,"confirmed"); let emailSent=false,lineSent=false;
    if(updated.email&&gmailReady())try{await sendMail({to:updated.email,subject:updated.isTest?"俐姐的家｜【測試】預約流程已完成":"俐姐的家｜您的預約已確認",text:confirmedEmailText(updated),html:confirmedEmailHtml(updated)});emailSent=true}catch(e){console.warn("confirm email failed",e)}
    if(updated.lineUserId)try{lineSent=await pushLine(updated.lineUserId,customerLineText(updated))}catch(e){console.warn("confirm customer LINE failed",e)}
    console.info("admin-booking-confirm",{bookingId:id,adminUid:admin.uid,emailSent,lineSent}); return res.status(200).json({ok:true,bookingId:id,emailSent,lineSent,isTest:Boolean(updated.isTest)});
  }catch(e){const code=String(e?.message||e);console.error("admin-booking-confirm failed",code);const status=code.startsWith("ADMIN_")?401:code==="DEPOSIT_NOT_PAID"?409:400;return res.status(status).json({ok:false,error:code});}
}
