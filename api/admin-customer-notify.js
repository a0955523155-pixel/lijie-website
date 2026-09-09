import { requireAdmin } from "./admin-auth.js";
import { getBooking, putBooking } from "./firestore-admin.js";
import { gmailReady, sendMail, refundCompletedMail, cancellationCompletedMail } from "./gmail-mailer.js";

function money(n){return `NT$ ${Math.max(0,Number(n)||0).toLocaleString("zh-TW")}`;}
function refundCard(b,{amount=0,method="轉帳",date="",reason=""}={}){
  const d=date||new Date().toISOString().slice(0,10);
  const rows=[
    ["訂單編號",b.id||"—"],["入住日期",b.startDate||"—"],["退款金額",money(amount)],["退款方式",method||"—"],["辦理日期",d]
  ].map(([label,value])=>({type:"box",layout:"horizontal",spacing:"sm",contents:[{type:"text",text:label,size:"sm",color:"#7A8581",flex:2},{type:"text",text:String(value),size:"sm",color:"#173A35",weight:"bold",flex:5,wrap:true}]}));
  if(reason) rows.push({type:"box",layout:"vertical",spacing:"xs",contents:[{type:"text",text:"退款說明",size:"xs",color:"#7A8581"},{type:"text",text:String(reason),size:"sm",color:"#173A35",wrap:true}]});
  return {type:"flex",altText:"俐姐的家｜退款已辦理，請留意查收",contents:{type:"bubble",size:"mega",header:{type:"box",layout:"vertical",backgroundColor:"#173A35",paddingAll:"22px",contents:[{type:"text",text:"LIJIE'S HOME",size:"xs",color:"#D6C497",weight:"bold"},{type:"text",text:"退款已為您辦理 💚",size:"xl",color:"#FFFFFF",weight:"bold",margin:"sm"},{type:"text",text:"麻煩您留意一下帳戶入帳狀況。",size:"sm",color:"#DCE7E3",wrap:true,margin:"xs"}]},body:{type:"box",layout:"vertical",paddingAll:"22px",spacing:"md",contents:[...rows,{type:"separator",margin:"md"},{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F8F4EA",cornerRadius:"12px",contents:[{type:"text",text:"款項已由俐姐這邊完成退款處理，實際入帳時間仍依銀行作業為準。若 1–3 個工作天後仍未收到，直接在這裡告訴我們，我們會協助確認。",size:"sm",color:"#58645F",wrap:true,lineSpacing:"5px"},{type:"text",text:"若這次造成您的不便，真的很抱歉，也期待下次有機會在後壁湖迎接您 🌿",size:"sm",color:"#2F6F62",wrap:true,margin:"md",weight:"bold"}]}]},footer:{type:"box",layout:"vertical",paddingAll:"16px",contents:[{type:"button",style:"primary",color:"#2F6F62",action:{type:"message",label:"查詢我的訂單",text:"查詢訂單"}}]}}};
}
function cancelledCard(b,{refundAmount=0,refundMethod="",refundDate="",reason="",depositDisposition=""}={}){
  const hasRefund=Number(refundAmount)>0;
  const rows=[["訂單編號",b.id||"—"],["原入住日期",b.startDate||"—"],["取消原因",reason||b.cancellationReason||"—"],["訂金處理",depositDisposition||b.depositDispositionLabel||"—"]];
  if(hasRefund)rows.push(["退款金額",money(refundAmount)],["退款方式",refundMethod||"—"],["退款日期",refundDate||new Date().toISOString().slice(0,10)]);
  return {type:"flex",altText:hasRefund?"俐姐的家｜取消已完成・退款已辦理":"俐姐的家｜取消預約已完成",contents:{type:"bubble",size:"mega",header:{type:"box",layout:"vertical",backgroundColor:"#173A35",paddingAll:"22px",contents:[{type:"text",text:"LIJIE'S HOME",size:"xs",color:"#D6C497",weight:"bold"},{type:"text",text:hasRefund?"取消已完成・退款已辦理 🌿":"取消預約已完成 🌿",size:"xl",color:"#FFFFFF",weight:"bold",margin:"sm"},{type:"text",text:hasRefund?"退款也已完成處理，麻煩您留意入帳。":"謝謝您提前告訴我們，這筆訂單已正式處理完成。",size:"sm",color:"#DCE7E3",wrap:true,margin:"xs"}]},body:{type:"box",layout:"vertical",paddingAll:"22px",spacing:"md",contents:[...rows.map(([label,value])=>({type:"box",layout:"horizontal",spacing:"sm",contents:[{type:"text",text:label,size:"sm",color:"#7A8581",flex:2},{type:"text",text:String(value),size:"sm",color:"#173A35",weight:"bold",flex:5,wrap:true}]})),{type:"separator",margin:"md"},{type:"text",text:hasRefund?"退款實際入帳時間依銀行作業為準；若 1–3 個工作天後仍未收到，請直接在這裡告訴我們，我們會協助確認。":"原住宿日期已重新釋出。",size:"sm",color:"#58645F",wrap:true,lineSpacing:"5px"},{type:"text",text:"若這次造成您的不便，真的很抱歉。很可惜這次沒能與您見面，也期待下次有機會在後壁湖迎接您 💚",size:"sm",color:"#2F6F62",wrap:true,weight:"bold"}]},footer:{type:"box",layout:"vertical",paddingAll:"16px",contents:[{type:"button",style:"primary",color:"#2F6F62",action:{type:"message",label:"查詢我的訂單",text:"查詢訂單"}}]}}};
}
async function pushLine(to,message){const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();if(!to||!token)return false;const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({to,messages:[message]})});if(!r.ok)throw new Error(`LINE_PUSH_FAILED ${r.status} ${await r.text()}`);return true;}
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
  try{
    const admin=await requireAdmin(req);const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});const bookingId=String(body.bookingId||"").trim(),event=String(body.event||"").trim();
    if(!bookingId)throw new Error("BOOKING_ID_REQUIRED");if(!["refund_completed","cancellation_completed"].includes(event))throw new Error("EVENT_INVALID");
    const b=await getBooking(bookingId);if(!b)throw new Error("BOOKING_NOT_FOUND");
    const amount=Math.max(0,Number(body.amount??body.refundAmount)||0),method=String(body.method||body.refundMethod||"轉帳"),date=String(body.date||body.refundDate||new Date().toISOString().slice(0,10)),reason=String(body.reason||"").trim(),depositDisposition=String(body.depositDisposition||b.depositDispositionLabel||"").trim(),notificationId=String(body.notificationId||"").trim();
    if(notificationId&&b.lastCustomerNotificationId===notificationId)return res.status(200).json({ok:true,alreadySent:true});
    let lineSent=false,emailSent=false;
    if(b.lineUserId){try{lineSent=await pushLine(b.lineUserId,event==="refund_completed"?refundCard(b,{amount,method,date,reason}):cancelledCard(b,{refundAmount:amount,refundMethod:method,refundDate:date,reason,depositDisposition}));}catch(e){console.warn("customer notify LINE failed",e)}}
    if(b.email&&gmailReady()){try{const m=event==="refund_completed"?refundCompletedMail(b,{amount,method,date,reason}):cancellationCompletedMail(b,{refundAmount:amount,refundMethod:method,refundDate:date,reason,depositDisposition});await sendMail({to:b.email,subject:m.subject,text:m.text,html:m.html});emailSent=true;}catch(e){console.warn("customer notify email failed",e)}}
    if(notificationId){const full={...b,lastCustomerNotificationId:notificationId,lastCustomerNotificationEvent:event,lastCustomerNotificationAt:new Date().toISOString(),updatedAt:new Date().toISOString()};delete full.id;await putBooking(bookingId,full);}
    console.info("admin-customer-notify",{bookingId,event,adminUid:admin.uid,lineSent,emailSent});return res.status(200).json({ok:true,lineSent,emailSent});
  }catch(e){const code=String(e?.message||e);console.error("admin-customer-notify failed",code);return res.status(code.startsWith("ADMIN_")?401:400).json({ok:false,error:code});}
}
