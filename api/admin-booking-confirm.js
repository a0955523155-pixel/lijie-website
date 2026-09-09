import { requireAdmin } from "./admin-auth.js";
import { getBooking, setBookingStatus } from "./firestore-admin.js";
import { gmailReady, sendMail, confirmedEmailText, confirmedEmailHtml } from "./gmail-mailer.js";
import { BOOKING_RULES } from "../js/booking-rules.js";
function customerLineMessages(b){
  const infoRows=[
    ["預約編號",b.id||"—"],
    ["入住日期",b.startDate||"—"],
    ["退房日期",b.endDate||"—"],
    ["入住人數",b.people?`${b.people} 人`:"—"],
    ["訂金狀態","NT$ 3,000 已確認入帳"]
  ].map(([label,value])=>({type:"box",layout:"horizontal",spacing:"sm",contents:[
    {type:"text",text:label,size:"sm",color:"#7A8581",flex:2},
    {type:"text",text:String(value),size:"sm",color:"#173A35",weight:"bold",flex:5,wrap:true}
  ]}));
  const card={
    type:"flex",
    altText:`俐姐的家｜預約已確認 ${b.startDate||""}`,
    contents:{
      type:"bubble",size:"mega",
      header:{type:"box",layout:"vertical",paddingAll:"22px",spacing:"xs",backgroundColor:"#173A35",contents:[
        {type:"text",text:"LIJIE'S HOME",size:"xs",color:"#D6C497",weight:"bold"},
        {type:"text",text:"預約已確認 💚",size:"xl",color:"#FFFFFF",weight:"bold",margin:"sm"},
        {type:"text",text:"訂金已確認入帳，期待與你見面。",size:"sm",color:"#DCE7E3",wrap:true,margin:"xs"}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"22px",spacing:"md",contents:[
        {type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F7F3EA",cornerRadius:"12px",contents:[
          {type:"text",text:"這次的住宿已經幫你保留好了 ✨",size:"sm",color:"#6A746F",wrap:true},
          {type:"text",text:`${b.startDate||"—"} → ${b.endDate||"—"}`,size:"lg",weight:"bold",color:"#173A35",margin:"sm",wrap:true}
        ]},
        {type:"box",layout:"vertical",spacing:"sm",contents:infoRows},
        {type:"separator",margin:"md"},
        {type:"text",text:"🌿 入住小提醒",size:"md",weight:"bold",color:"#173A35"},
        {type:"text",text:`入住 ${BOOKING_RULES.checkInFrom} 起｜退房 ${BOOKING_RULES.checkOutBy} 前`,size:"sm",color:"#58645F",wrap:true},
        {type:"text",text:"完整入住須知會接著傳給你，入住前再看一次就好。",size:"xs",color:"#7A8581",wrap:true}
      ]},
      footer:{type:"box",layout:"vertical",paddingAll:"16px",contents:[
        {type:"box",layout:"vertical",paddingAll:"12px",backgroundColor:"#E7F4EE",cornerRadius:"10px",contents:[
          {type:"text",text:"✅ 預約正式成立",align:"center",weight:"bold",size:"sm",color:"#24634F"}
        ]}
      ]}
    }
  };
  const rules=[
    `1. 入住時間：${BOOKING_RULES.checkInFrom} 起；退房時間：${BOOKING_RULES.checkOutBy} 前。`,
    `2. 全館最多入住 ${BOOKING_RULES.maxGuests} 人，實際入住人數請與預約一致；如需增加人數，請先透過官方 LINE 確認。`,
    "3. 若預計較晚抵達，請提前透過官方 LINE 告知。",
    "4. 夜間請降低音量，並配合現場規範與鄰里安寧。",
    "5. KTV、烤肉、麻將及其他公共設施，請依現場規範與雙方確認內容使用。",
    "6. 請妥善使用客房、家具與設備；若發現異常或損壞，請立即通知民宿。",
    "7. 離開房間或退房前，請確認個人物品、門窗與電器狀況。",
    "8. 如需更改日期、取消預約或詢問住宿安排，請統一透過俐姐的家官方 LINE 聯繫。"
  ];
  const rulesText=`🌿 俐姐的家｜入住須知\n\n${rules.join("\n\n")}\n\n有任何問題直接在這裡問我們就可以了 💚`;
  return [card,{type:"text",text:rulesText}];
}
async function pushLine(to,messages){const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();if(!to||!token)return false;const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({to,messages})});if(!r.ok){const detail=await r.text().catch(()=>"");throw new Error(`LINE_PUSH_FAILED ${r.status} ${detail}`.trim())}return true;}
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
  try{
    const admin=await requireAdmin(req); const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{}); const id=String(body.bookingId||"").trim();
    if(!id)throw new Error("BOOKING_ID_REQUIRED"); const current=await getBooking(id); if(!current)throw new Error("BOOKING_NOT_FOUND");
    if(current.status==="cancelled")throw new Error("BOOKING_CANCELLED"); if(current.status==="confirmed")return res.status(200).json({ok:true,alreadyConfirmed:true});
    const dep=Number(current.depositRequired||3000),paid=Number(current.paidAmount||current.amountReceived||0); if(paid<dep)throw new Error("DEPOSIT_NOT_PAID");
    const updated=await setBookingStatus(id,"confirmed"); let emailSent=false,lineSent=false;
    if(updated.email&&gmailReady())try{await sendMail({to:updated.email,subject:updated.isTest?"俐姐的家｜【測試】預約流程已完成":"俐姐的家｜您的預約已確認",text:confirmedEmailText(updated),html:confirmedEmailHtml(updated)});emailSent=true}catch(e){console.warn("confirm email failed",e)}
    if(updated.lineUserId)try{lineSent=await pushLine(updated.lineUserId,customerLineMessages(updated))}catch(e){console.warn("confirm customer LINE failed",e)}
    console.info("admin-booking-confirm",{bookingId:id,adminUid:admin.uid,emailSent,lineSent}); return res.status(200).json({ok:true,bookingId:id,emailSent,lineSent,isTest:Boolean(updated.isTest)});
  }catch(e){const code=String(e?.message||e);console.error("admin-booking-confirm failed",code);const status=code.startsWith("ADMIN_")?401:code==="DEPOSIT_NOT_PAID"?409:400;return res.status(status).json({ok:false,error:code});}
}
