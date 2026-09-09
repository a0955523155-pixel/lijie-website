import { BOOKING_RULES } from "../js/booking-rules.js";
const TOKEN_URL="https://oauth2.googleapis.com/token";
function cfg(){return{clientId:String(process.env.GMAIL_CLIENT_ID||"").trim(),clientSecret:String(process.env.GMAIL_CLIENT_SECRET||"").trim(),refreshToken:String(process.env.GMAIL_REFRESH_TOKEN||"").trim(),sender:String(process.env.GMAIL_SENDER_EMAIL||"").trim(),senderName:String(process.env.GMAIL_SENDER_NAME||"俐姐的家").trim()};}
export function gmailReady(){const c=cfg();return Boolean(c.clientId&&c.clientSecret&&c.refreshToken&&c.sender);}
export function adminNotificationEmail(){const c=cfg();return String(process.env.ADMIN_NOTIFICATION_EMAIL||c.sender||"").trim();}
async function access(){const c=cfg();if(!gmailReady())throw new Error("GMAIL_NOT_CONFIGURED");const r=await fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,refresh_token:c.refreshToken,grant_type:"refresh_token"})});if(!r.ok)throw new Error(`GMAIL_TOKEN_FAILED ${r.status} ${await r.text()}`);return(await r.json()).access_token;}
function clean(v){return String(v||"").replace(/[\r\n]+/g," ").trim();}
function enc(v){return `=?UTF-8?B?${Buffer.from(String(v||""),"utf8").toString("base64")}?=`;}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
export async function sendMail({to,subject,text,html}){
  if(!to)return{skipped:true};
  const c=cfg(),tok=await access();
  const encodeBody=v=>Buffer.from(String(v||""),"utf8").toString("base64");
  let body;
  if(html){
    const boundary=`lijie_${Date.now().toString(36)}`;
    body=[
      `From: ${enc(clean(c.senderName))} <${clean(c.sender)}>`,`To: ${clean(to)}`,
      `Subject: ${enc(String(subject||""))}`,"MIME-Version: 1.0",`Content-Type: multipart/alternative; boundary="${boundary}"`,"",
      `--${boundary}`,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",encodeBody(text),
      `--${boundary}`,"Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: base64","",encodeBody(html),
      `--${boundary}--`,""
    ].join("\r\n");
  }else{
    body=[`From: ${enc(clean(c.senderName))} <${clean(c.sender)}>`,`To: ${clean(to)}`,`Subject: ${enc(String(subject||""))}`,"MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",encodeBody(text),""].join("\r\n");
  }
  const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${tok}`,"Content-Type":"application/json"},body:JSON.stringify({raw:Buffer.from(body,"utf8").toString("base64url")})});
  if(!r.ok)throw new Error(`GMAIL_SEND_FAILED ${r.status} ${await r.text()}`);
  return{ok:true};
}
export function receivedEmailText(b){const test=Boolean(b.isTest);return[`${b.guestName||b.name||"您好"} 您好：`,"",test?"【測試模式】這是一筆測試預約，不會列入正式營運統計。":"我們已收到您在「俐姐的家」送出的預約需求。","",`預約編號：${b.id||"—"}`,`入住日期：${b.startDate||b.checkIn}`,`退房日期：${b.endDate||b.checkOut}`,`入住人數：${b.people?`${b.people} 人`:"未填"}`,"",`固定訂金：NT$ 3,000`,"目前狀態：預約申請已收到，等待訂金入帳。","此封信代表已收到需求，尚不代表預約正式成立。須先完成 NT$3,000 訂金，並由俐姐於官網後台確認後才正式成立。","","付款資訊：高雄市鳥松區農會｜農分會代號 619-1089｜戶名 吳俐潔 小姐｜匯款帳號 01089210623310",...(test?["","測試提醒：測試訂單確認時不會鎖定正式官網日期，可由後台一鍵清除測試資料。"]:[]),"","俐姐的家"].join("\n");}
export function confirmedEmailText(b){
  const test=Boolean(b.isTest);
  return [
    `${b.guestName||"您好"} 您好：`,
    "",
    test?"【測試模式】預約確認流程已完成。":"您的「俐姐的家」預約已正式確認。",
    "",
    `預約編號：${b.id||"—"}`,
    `入住日期：${b.startDate||"—"}`,
    `退房日期：${b.endDate||"—"}`,
    `入住人數：${b.people?`${b.people} 人`:"未填"}`,
    "",
    "【入住須知】",
    `1. 入住時間：${BOOKING_RULES.checkInFrom} 起；退房時間：${BOOKING_RULES.checkOutBy} 前。`,
    `2. 全館最多入住 ${BOOKING_RULES.maxGuests} 人，實際入住人數請與預約資料一致；若需增加人數，請先由官方 LINE 確認。`,
    "3. 若預計較晚抵達，請提前透過官方 LINE 告知。",
    "4. 夜間請降低音量，並配合現場使用規範與鄰里安寧。",
    "5. KTV、烤肉、麻將及其他公共設施，請依現場規範與雙方確認內容使用。",
    "6. 請妥善使用客房、家具與設備；若發現異常或損壞，請立即通知民宿。",
    "7. 離開房間或退房前，請確認個人物品、門窗與電器狀況。",
    "8. 如需更改日期、取消預約或詢問住宿安排，請統一透過俐姐的家官方 LINE 聯繫。",
    "",
    test?"此為測試訂單，不會鎖定正式住宿日期。":"祝您旅途愉快，我們入住時見。",
    "",
    "俐姐的家｜墾丁後壁湖"
  ].join("\n");
}
function siteBase(){return String(process.env.PUBLIC_SITE_URL||process.env.SITE_URL||"https://www.5-1bbs.com").trim().replace(/\/$/,"");}
export function adminOperationsUrl(b){const q=new URLSearchParams({tab:"operations"});if(b?.startDate)q.set("date",String(b.startDate));if(b?.id)q.set("booking",String(b.id));return `${siteBase()}/admin/?${q.toString()}`;}
export function newBookingAdminMail(b){const total=Number(b.totalAmount??b.quotedTotal??0)||0,dep=Number(b.depositRequired||3000)||3000,url=adminOperationsUrl(b),test=Boolean(b.isTest);const subject=`俐姐的家｜${test?"【測試】":""}新訂單 ${b.startDate||""} ${b.guestName||"未填"}`;const text=[test?"【測試訂單】":"【新訂單通知】",`訂單編號：${b.id||"—"}`,`入住：${b.startDate||"—"}`,`退房：${b.endDate||"—"}`,`人數：${b.people?`${b.people} 人`:"未填"}`,`姓名：${b.guestName||"未填"}`,`電話：${b.phone||"未填"}`,`Email：${b.email||"未填"}`,`住宿總額：${total>0?`NT$ ${total.toLocaleString("zh-TW")}`:"未設定"}`,`固定訂金：NT$ ${dep.toLocaleString("zh-TW")}`,`目前狀態：待收訂金／待後台確認`,"",`前往營運管理：${url}`].join("\n");const html=`<!doctype html><html><body style="margin:0;padding:0;background:#f4f1e9;font-family:Arial,'Noto Sans TC',sans-serif;color:#173a35"><div style="max-width:620px;margin:0 auto;padding:28px 18px"><div style="background:#173a35;color:#fff;padding:24px;border-radius:16px 16px 0 0"><div style="font-size:12px;letter-spacing:2px;color:#cdbd92">LIJIE'S HOME</div><h1 style="margin:8px 0 0;font-size:24px">${test?"測試新訂單":"收到新訂單"}</h1></div><div style="background:#fff;padding:24px;border-radius:0 0 16px 16px"><p style="margin:0 0 18px;color:#6b756f">${esc(b.startDate||"—")} → ${esc(b.endDate||"—")}・${b.people?`${esc(b.people)} 人`:"人數未填"}</p><table style="width:100%;border-collapse:collapse;font-size:15px"><tr><td style="padding:8px 0;color:#7a8581">訂單編號</td><td style="padding:8px 0;font-weight:700">${esc(b.id||"—")}</td></tr><tr><td style="padding:8px 0;color:#7a8581">客戶</td><td style="padding:8px 0;font-weight:700">${esc(b.guestName||"未填")}</td></tr><tr><td style="padding:8px 0;color:#7a8581">電話</td><td style="padding:8px 0">${esc(b.phone||"未填")}</td></tr><tr><td style="padding:8px 0;color:#7a8581">Email</td><td style="padding:8px 0">${esc(b.email||"未填")}</td></tr><tr><td style="padding:8px 0;color:#7a8581">住宿總額</td><td style="padding:8px 0;font-weight:700">${total>0?`NT$ ${total.toLocaleString("zh-TW")}`:"未設定"}</td></tr><tr><td style="padding:8px 0;color:#7a8581">固定訂金</td><td style="padding:8px 0;font-weight:700">NT$ ${dep.toLocaleString("zh-TW")}</td></tr><tr><td style="padding:8px 0;color:#7a8581">目前狀態</td><td style="padding:8px 0">待收訂金／待後台確認</td></tr></table><div style="margin-top:24px"><a href="${esc(url)}" style="display:inline-block;background:#173a35;color:#fff;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:700">前往營運管理查看訂單</a></div><p style="margin:18px 0 0;font-size:12px;color:#8b938f">此信僅作新訂單通知，訂單確認、收款、退款與取消請在官網後台操作。</p></div></div></body></html>`;return{subject,text,html,url};}


function cardHtml({eyebrow="LIJIE'S HOME",title,subtitle="",rows=[],notice="",buttonLabel="",buttonUrl="",tone="#173a35"}){
  const trs=rows.map(([k,v])=>`<tr><td style="padding:9px 0;color:#78827d;width:34%;vertical-align:top">${esc(k)}</td><td style="padding:9px 0;color:#20322d;font-weight:700;vertical-align:top">${esc(v)}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3efe6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',Arial,sans-serif;color:#20322d"><div style="max-width:640px;margin:0 auto;padding:32px 16px"><div style="background:${tone};padding:28px 28px 24px;border-radius:18px 18px 0 0"><div style="font-size:11px;letter-spacing:2.4px;color:#d6c497;font-weight:700">${esc(eyebrow)}</div><h1 style="margin:9px 0 0;color:#fff;font-size:26px;line-height:1.35">${esc(title)}</h1>${subtitle?`<p style="margin:8px 0 0;color:#dce7e3;font-size:14px;line-height:1.7">${esc(subtitle)}</p>`:""}</div><div style="background:#fff;padding:26px 28px;border-radius:0 0 18px 18px;box-shadow:0 10px 30px rgba(30,50,45,.06)"><table style="width:100%;border-collapse:collapse;font-size:15px">${trs}</table>${notice?`<div style="margin-top:20px;padding:14px 16px;background:#f8f4ea;border-radius:12px;color:#58645f;font-size:13px;line-height:1.8">${esc(notice)}</div>`:""}${buttonUrl?`<div style="margin-top:24px"><a href="${esc(buttonUrl)}" style="display:inline-block;background:#173a35;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">${esc(buttonLabel||"查看詳情")}</a></div>`:""}<p style="margin:24px 0 0;font-size:12px;color:#969e9a">俐姐的家｜墾丁後壁湖</p></div></div></body></html>`;
}
export function receivedEmailHtml(b){
  const total=Number(b.totalAmount??b.quotedTotal??0)||0;
  return cardHtml({title:b.isTest?"測試預約已收到":"預約需求已收到",subtitle:"完成訂金並由民宿確認後，預約才正式成立。",rows:[["預約編號",b.id||"—"],["入住日期",b.startDate||b.checkIn||"—"],["退房日期",b.endDate||b.checkOut||"—"],["入住人數",b.people?`${b.people} 人`:"未填"],["住宿總額",total>0?`NT$ ${total.toLocaleString("zh-TW")}`:"待確認"],["固定訂金","NT$ 3,000"],["目前狀態","等待訂金入帳"]],notice:"付款資訊：高雄市鳥松區農會／農分會代號 619-1089／戶名 吳俐潔 小姐／匯款帳號 01089210623310。此信代表已收到需求，尚不代表預約正式成立。"});
}
export function confirmedEmailHtml(b){
  const stayItems=[
    `入住時間：${BOOKING_RULES.checkInFrom} 起；退房時間：${BOOKING_RULES.checkOutBy} 前。`,
    `全館最多入住 ${BOOKING_RULES.maxGuests} 人；實際入住人數請與預約資料一致，若需增加人數請先透過官方 LINE 確認。`,
    "若預計較晚抵達，請提前透過官方 LINE 告知。",
    "夜間請降低音量，並配合現場使用規範與鄰里安寧。",
    "KTV、烤肉、麻將及其他公共設施，請依現場規範與雙方確認內容使用。",
    "請妥善使用客房、家具與設備；若發現異常或損壞，請立即通知民宿。",
    "離開房間或退房前，請確認個人物品、門窗與電器狀況。",
    "如需更改日期、取消預約或詢問住宿安排，請統一透過俐姐的家官方 LINE 聯繫。"
  ];
  const lis=stayItems.map((item)=>`<li style="margin:0 0 10px;padding-left:2px;line-height:1.75">${esc(item)}</li>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3efe6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',Arial,sans-serif;color:#20322d"><div style="max-width:640px;margin:0 auto;padding:32px 16px"><div style="background:#173a35;padding:28px;border-radius:18px 18px 0 0"><div style="font-size:11px;letter-spacing:2.4px;color:#d6c497;font-weight:700">LIJIE'S HOME</div><h1 style="margin:9px 0 0;color:#fff;font-size:26px;line-height:1.35">${b.isTest?"測試預約已確認":"預約已正式確認"}</h1><p style="margin:8px 0 0;color:#dce7e3;font-size:14px;line-height:1.7">以下為本次住宿資訊與入住須知。</p></div><div style="background:#fff;padding:26px 28px;border-radius:0 0 18px 18px;box-shadow:0 10px 30px rgba(30,50,45,.06)"><table style="width:100%;border-collapse:collapse;font-size:15px"><tr><td style="padding:8px 0;color:#78827d;width:34%">預約編號</td><td style="padding:8px 0;font-weight:700">${esc(b.id||"—")}</td></tr><tr><td style="padding:8px 0;color:#78827d">入住日期</td><td style="padding:8px 0;font-weight:700">${esc(b.startDate||"—")}</td></tr><tr><td style="padding:8px 0;color:#78827d">退房日期</td><td style="padding:8px 0;font-weight:700">${esc(b.endDate||"—")}</td></tr><tr><td style="padding:8px 0;color:#78827d">入住人數</td><td style="padding:8px 0;font-weight:700">${b.people?`${esc(b.people)} 人`:"未填"}</td></tr></table><div style="height:1px;background:#ebe6dc;margin:22px 0"></div><h2 style="font-size:19px;margin:0 0 14px;color:#173a35">入住須知</h2><ol style="margin:0;padding-left:20px;color:#4d5b56;font-size:14px">${lis}</ol>${b.isTest?`<div style="margin-top:20px;padding:13px 15px;background:#fff5cf;border-radius:10px;color:#765b00;font-size:13px">此為測試訂單，不會鎖定正式住宿日期。</div>`:""}<p style="margin:24px 0 0;font-size:12px;color:#969e9a">俐姐的家｜墾丁後壁湖</p></div></div></body></html>`;
}
export function cancellationRequestMail(b,reason,{admin=false}={}){
  const url=admin?adminOperationsUrl(b):"";
  const subject=admin?`俐姐的家｜取消預約申請 ${b.startDate||""} ${b.guestName||""}`:"俐姐的家｜已收到您的取消預約申請";
  const text=[admin?"【收到取消預約申請】":"我們已收到您的取消預約申請。",`訂單編號：${b.id}`,`入住日期：${b.startDate||"—"}`,`退房日期：${b.endDate||"—"}`,`取消原因：${reason}`,"","目前僅為取消申請，訂單尚未正式取消；住宿日期也尚未釋出。","訂金是否保留、部分退款或全額退款，會由民宿確認後處理。",...(admin?["",`前往營運管理：${url}`]:[])].join("\n");
  const html=cardHtml({title:admin?"收到取消預約申請":"取消預約申請已收到",subtitle:admin?"請前往營運管理確認訂金與後續處理。":"目前仍是申請階段，尚未正式取消。",rows:[["訂單編號",b.id||"—"],["入住日期",b.startDate||"—"],["退房日期",b.endDate||"—"],["客戶",b.guestName||"—"],["取消原因",reason]],notice:"正式取消完成前，住宿日期不會釋出；已收訂金的保留或退款方式將由民宿確認後處理。",buttonLabel:admin?"前往營運管理":"",buttonUrl:url});
  return {subject,text,html};
}
export function refundRequestMail(b,reason,{admin=false}={}){
  const url=admin?adminOperationsUrl(b):"";
  const subject=admin?`俐姐的家｜退款申請 ${b.startDate||""} ${b.guestName||""}`:"俐姐的家｜已收到您的退款申請";
  const text=[admin?"【收到退款申請】":"我們已收到您的退款申請。",`訂單編號：${b.id}`,`入住日期：${b.startDate||"—"}`,`已收金額：NT$ ${Number(b.paidAmount||0).toLocaleString("zh-TW")}`,`申請原因：${reason}`,"","退款尚未完成，實際退款金額與方式將由民宿確認後處理。",...(admin?["",`前往營運管理：${url}`]:[])].join("\n");
  const html=cardHtml({title:admin?"收到退款申請":"退款申請已收到",subtitle:"退款尚未完成，將由民宿核對訂單與已收款後處理。",rows:[["訂單編號",b.id||"—"],["入住日期",b.startDate||"—"],["客戶",b.guestName||"—"],["目前已收",`NT$ ${Number(b.paidAmount||0).toLocaleString("zh-TW")}`],["申請原因",reason]],notice:"退款金額、退款方式與是否符合退款條件，均以民宿後台最終處理結果為準。",buttonLabel:admin?"前往營運管理":"",buttonUrl:url});
  return {subject,text,html};
}
export function paymentReportAdminMail(b){
  const url=adminOperationsUrl(b);
  const amount=Number(b.paymentReportAmount||0)||0;
  const subject=`俐姐的家｜匯款回報 ${b.startDate||""} ${b.guestName||""}`;
  const text=["【收到客戶匯款回報】",`訂單編號：${b.id||"—"}`,`入住日期：${b.startDate||"—"}`,`客戶：${b.guestName||"—"}`,`回報金額：NT$ ${amount.toLocaleString("zh-TW")}`,`匯款帳號末五碼：${b.paymentReportLast5||"—"}`,"","此為客戶回報，尚未代表實際入帳。請至營運管理核對銀行帳戶後，再新增正式收款紀錄。","",`前往營運管理：${url}`].join("\n");
  const html=cardHtml({title:"收到客戶匯款回報",subtitle:"請核對銀行帳戶後，再於營運管理登記正式收款。",rows:[["訂單編號",b.id||"—"],["入住日期",b.startDate||"—"],["客戶",b.guestName||"—"],["回報金額",`NT$ ${amount.toLocaleString("zh-TW")}`],["帳號末五碼",b.paymentReportLast5||"—"],["目前狀態","待人工核帳"]],notice:"客戶的匯款回報不是入帳證明；請實際核對銀行帳戶後，再於後台新增收款紀錄。",buttonLabel:"前往營運管理核帳",buttonUrl:url});
  return {subject,text,html};
}

