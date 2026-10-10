import crypto from "node:crypto";
export const SETTINGS_PATH="settings/housekeepingReminders";
export const stayKey=b=>crypto.createHash("sha256").update(`${b.id}\0${b.startDate}\0${b.endDate}${b.housekeepingRevision?`\0${b.housekeepingRevision}`:""}`).digest("hex").slice(0,40);
export const notificationEventKey=j=>`HE${crypto.createHash("sha256").update(`${j.bookingId}\0${j.activationId}\0${j.kind}\0${j.kind==="checkout"?j.endDate:j.startDate}`).digest("hex").slice(0,40)}`;
export function reminderSettings(input={}){
  const contactName=String(input.contactName||"").trim().slice(0,80),email=String(input.email||"").trim(),arrivalTime=String(input.arrivalTime||""),checkoutTime=String(input.checkoutTime||"");
  if(email&&!/^[^\s@,;\r\n]+@[^\s@,;\r\n]+\.[^\s@,;\r\n]+$/.test(email))throw new Error("INVALID_REMINDER_EMAIL");
  const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if((arrivalTime&&!validTime(arrivalTime))||(checkoutTime&&!validTime(checkoutTime)))throw new Error("INVALID_REMINDER_TIME");
  return {contactName,email,arrivalTime,checkoutTime,timeZone:"Asia/Taipei",enabled:false,ready:Boolean(contactName&&email&&validTime(arrivalTime)&&validTime(checkoutTime))};
}
export function newConfirmationJobs(booking,settings,now=new Date()){
  if(!settings?.enabled||!settings.activationId||!reminderSettings(settings).ready||booking.isTest||booking.status!=="confirmed")return [];
  const today=now.toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"}),revision=stayKey(booking);
  const times=[{kind:"confirmed",date:booking.startDate,dueAt:now.toISOString()},{kind:"arrival",date:booking.startDate,dueAt:new Date(`${booking.startDate}T${settings.arrivalTime}:00+08:00`).toISOString()},{kind:"checkout",date:booking.endDate,dueAt:new Date(`${booking.endDate}T${settings.checkoutTime}:00+08:00`).toISOString()}];
  return times.filter(x=>x.date>=today).map(x=>({id:`HN${revision}-${x.kind}`,bookingId:booking.id,startDate:booking.startDate,endDate:booking.endDate,revision,activationId:settings.activationId,kind:x.kind,dueAt:x.date===today&&x.dueAt<now.toISOString()?now.toISOString():x.dueAt,status:"pending",createdAt:now.toISOString()}));
}
export function housekeepingMail(job,booking,settings){
  const day=job.kind==="checkout"?job.endDate:job.startDate,url=`https://www.5-1bbs.com/housekeeping/?date=${encodeURIComponent(day)}&booking=${encodeURIComponent(job.bookingId)}`;
  const content={confirmed:["新預約已確認",`入住 ${booking.startDate}，退房 ${booking.endDate}。`],arrival:["今天有客戶入住","請提前備妥鑰匙；若有密碼鎖，請將密碼回傳官方 LINE。"],checkout:["今天退房，請回報整備完成","整理完成 → 拍一張客廳整潔照片 → 按完成回報。完成紀錄會留在後台。"]}[job.kind];
  return {to:settings.email,subject:`俐姐的家｜${content[0]}`,text:`${settings.contactName}您好：\n${content[0]}\n${content[1]}\n入住 ${booking.startDate}｜退房 ${booking.endDate}\n房務工作台：${url}`};
}

export async function replaceStayReminderJobs(tx,before,after,settings,now){
  const kinds=["confirmed","arrival","checkout"],revision=stayKey(before);
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
    const previous=old[kinds.indexOf(job.kind)],event=events[index],day=x=>x.kind==="checkout"?x.endDate:x.startDate;
    if(previous&&day(previous)===day(job)){
      if(["sent","manually_verified","suppressed"].includes(previous.status))job.status="suppressed";
      else if(["sending","delivery_uncertain","held_for_review"].includes(previous.status))job.status="held_for_review";
      if(job.status!=="pending")job.previousJobId=`HN${revision}-${job.kind}`;
    }
    if(event){if(["sent","manually_verified"].includes(event.status))job.status="suppressed";else if(["sending","delivery_uncertain"].includes(event.status))job.status="held_for_review";job.previousJobId=event.notificationId;}
    tx.set(`housekeepingNotifications/${job.id}`,job);
  });
}
