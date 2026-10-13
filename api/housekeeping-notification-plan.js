import crypto from "node:crypto";
import {BOOKING_RULES} from "../js/booking-rules.js";
export const SETTINGS_PATH="settings/housekeepingReminders";
export const stayKey=b=>crypto.createHash("sha256").update(`${b.id}\0${b.startDate}\0${b.endDate}${b.housekeepingRevision?`\0${b.housekeepingRevision}`:""}`).digest("hex").slice(0,40);
export const NOTIFICATION_KINDS=["confirmed","pre_arrival","arrival","checkout"];
export const notificationDay=job=>job.kind==="pre_arrival"?new Date(job.scheduledFor||job.dueAt).toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"}):job.kind==="checkout"?job.endDate:job.startDate;
export function notificationExpired(job,now){
  return notificationDay(job)<now.toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"})||
    (job.kind==="pre_arrival"&&now.getTime()>=new Date(`${job.startDate}T${BOOKING_RULES.checkInFrom}:00+08:00`).getTime());
}
// These ordinary configuration values control delivery only, never authentication.
export function configuredReminderSettings(input={}){
  const contactName=String(process.env.HOUSEKEEPING_NOTIFICATION_CONTACT_NAME||"").trim();
  const email=String(process.env.HOUSEKEEPING_NOTIFICATION_EMAIL||"").trim();
  const managed=Boolean(contactName&&email),values={...input,...(managed?{contactName,email}:{})};
  return {...values,...reminderSettings(values),enabled:input.enabled===true,contactManaged:managed};
}
export const notificationEventKey=j=>`HE${crypto.createHash("sha256").update(`${j.bookingId}\0${j.activationId}\0${j.kind}\0${notificationDay(j)}`).digest("hex").slice(0,40)}`;
export function reminderSettings(input={}){
  const contactName=String(input.contactName||"").trim().slice(0,80),email=String(input.email||"").trim(),arrivalTime=String(input.arrivalTime||""),checkoutTime=String(input.checkoutTime||"");
  if(email&&!/^[^\s@,;\r\n]+@[^\s@,;\r\n]+\.[^\s@,;\r\n]+$/.test(email))throw new Error("INVALID_REMINDER_EMAIL");
  const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if((arrivalTime&&!validTime(arrivalTime))||(checkoutTime&&!validTime(checkoutTime)))throw new Error("INVALID_REMINDER_TIME");
  const preArrivalMinutes=input.preArrivalMinutes==null||input.preArrivalMinutes===""?null:Number(input.preArrivalMinutes);
  if(preArrivalMinutes!==null&&(!Number.isSafeInteger(preArrivalMinutes)||preArrivalMinutes<1||preArrivalMinutes>43200))throw new Error("INVALID_PRE_ARRIVAL_OFFSET");
  return {contactName,email,arrivalTime,checkoutTime,preArrivalMinutes,timeZone:"Asia/Taipei",enabled:false,ready:Boolean(contactName&&email&&validTime(arrivalTime)&&validTime(checkoutTime)&&preArrivalMinutes!==null)};
}
export function newConfirmationJobs(booking,settings,now=new Date()){
  settings=configuredReminderSettings(settings||{});
  if(!settings?.enabled||!settings.activationId||!reminderSettings(settings).ready||booking.isTest||booking.status!=="confirmed")return [];
  const today=now.toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"}),revision=stayKey(booking);
  const preparationAt=new Date(new Date(`${booking.startDate}T${BOOKING_RULES.checkInFrom}:00+08:00`).getTime()-settings.preArrivalMinutes*60000);
  const times=[{kind:"confirmed",date:booking.startDate,dueAt:now.toISOString()},
    {kind:"pre_arrival",date:preparationAt.toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"}),dueAt:preparationAt.toISOString()},
    {kind:"arrival",date:booking.startDate,dueAt:new Date(`${booking.startDate}T${settings.arrivalTime}:00+08:00`).toISOString()},
    {kind:"checkout",date:booking.endDate,dueAt:new Date(`${booking.endDate}T${settings.checkoutTime}:00+08:00`).toISOString()}];
  return times.filter(x=>x.date>=today&&!notificationExpired({...x,startDate:booking.startDate,endDate:booking.endDate},now)).map(x=>({id:`HN${revision}-${x.kind}`,bookingId:booking.id,startDate:booking.startDate,endDate:booking.endDate,revision,activationId:settings.activationId,kind:x.kind,scheduledFor:x.dueAt,dueAt:x.date===today&&x.dueAt<now.toISOString()?now.toISOString():x.dueAt,status:"pending",createdAt:now.toISOString()}));
}
export function housekeepingMail(job,booking,settings){
  const day=job.kind==="checkout"?job.endDate:job.startDate,url=`https://www.5-1bbs.com/housekeeping/?date=${encodeURIComponent(day)}&booking=${encodeURIComponent(job.bookingId)}`;
  const preparation="請在入住前備妥鑰匙；若有密碼鎖，請將密碼回傳官方 LINE @287ppyfa：https://line.me/R/ti/p/@287ppyfa 。";
  const content={confirmed:["新預約已確認",`請確認後續房務安排。${preparation}`],pre_arrival:["入住前準備提醒",preparation],arrival:["今天有客戶入住",`請確認入住準備已完成。${preparation}`],checkout:["今天退房，請回報整備完成","請確認住客已退房再清潔。整理完成 → 至少拍一張客廳整潔照片 → 按完成回報。時間、照片與狀態會留在後台，回報完成後停止這次退房催報。"]}[job.kind];
  if(!content)throw new Error("INVALID_REMINDER_KIND");
  return {to:settings.email,subject:`俐姐的家｜${content[0]}`,text:`${settings.contactName}您好：\n${content[0]}\n訂單 ${job.bookingId}\n入住 ${booking.startDate} ${BOOKING_RULES.checkInFrom} 起｜退房 ${booking.endDate} ${BOOKING_RULES.checkOutBy} 前（Asia/Taipei）\n入住人數：${Number(booking.people)||0} 位\n${content[1]}\n房務工作台：${url}\n請使用已授權的房務帳號登入；收件信箱不會自動取得登入權限。`};
}

export async function replaceStayReminderJobs(tx,before,after,settings,now){
  const kinds=NOTIFICATION_KINDS,revision=stayKey(before);
  const old=await Promise.all(kinds.map(kind=>tx.get(`housekeepingNotifications/HN${revision}-${kind}`)));
  // Only stays enrolled by a new confirmation in this activation can reschedule.
  // Enabling reminders or editing an older booking never backfills its history.
  const eligible=before.housekeepingNotificationActivationId===settings?.activationId;
  const planned=eligible?newConfirmationJobs(after,settings,now):[];
  const jobs=planned.filter(job=>job.kind!=="confirmed"||old[0]?.status==="pending");
  const existing=await Promise.all(jobs.map(job=>tx.get(`housekeepingNotifications/${job.id}`)));
  const events=await Promise.all(jobs.map(job=>tx.get(`housekeepingNotificationEvents/${notificationEventKey(job)}`)));
  old.forEach((job,index)=>{if(job)tx.set(`housekeepingNotifications/HN${revision}-${kinds[index]}`,{...(job.status==="pending"?{status:"stale"}:{}),supersededAt:now.toISOString()},true);});
  jobs.forEach((job,index)=>{
    if(existing[index])return;
    const previous=old[kinds.indexOf(job.kind)],event=events[index],day=notificationDay;
    if(previous&&day(previous)===day(job)){
      if(["sent","manually_verified","suppressed"].includes(previous.status))job.status="suppressed";
      else if(["sending","delivery_uncertain","held_for_review"].includes(previous.status))job.status="held_for_review";
      if(job.status!=="pending")job.previousJobId=`HN${revision}-${job.kind}`;
    }
    if(event){if(["sent","manually_verified"].includes(event.status))job.status="suppressed";else if(["sending","delivery_uncertain"].includes(event.status))job.status="held_for_review";job.previousJobId=event.notificationId;}
    tx.set(`housekeepingNotifications/${job.id}`,job);
  });
}
