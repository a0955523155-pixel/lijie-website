import crypto from "node:crypto";
import {bookingTransaction,getPrivateRecord,listCollectionRecords} from "./firestore-admin.js";
import {SETTINGS_PATH,stayKey,housekeepingMail,notificationEventKey,notificationExpired,configuredReminderSettings,planChangeNotice,isChangeNotice} from "./housekeeping-notification-plan.js";
import {reportId} from "./housekeeping-records.js";
import {gmailReady,sendMail} from "./gmail-mailer.js";
const noticePriority={cancelled:0,rescheduled:1,confirmed:2,pre_arrival:3,arrival:4,checkout:5};
export function notificationApplicable(job,booking,settings,now,complete){
  return Boolean(booking&&!booking.isTest&&booking.status===(job.kind==="cancelled"?"cancelled":"confirmed")&&
    stayKey({id:job.bookingId,...booking})===job.revision&&settings.activationId===job.activationId&&
    !job.supersededAt&&complete?.status!=="completed"&&!notificationExpired(job,now));
}
// Reconcile only stays enrolled in this activation. This repairs a lost callback
// from the existing browser cancellation transaction without touching orders.
async function reconcileCancellations(records,settings,now,bookingId){
  const ids=[...new Set(records.filter(j=>j.activationId===settings.activationId&&(!bookingId||j.bookingId===bookingId)).map(j=>j.bookingId))];
  for(const id of ids)await bookingTransaction(async tx=>{
    const config=configuredReminderSettings(await tx.get(SETTINGS_PATH)||{});if(!config.enabled)return;
    const booking=await tx.get(`bookings/${id}`);if(!booking||booking.status!=="cancelled"||booking.housekeepingNotificationActivationId!==config.activationId)return;
    await planChangeNotice(tx,{id,...booking},{id,...booking},config,"cancelled",now);
    for(const j of records.filter(j=>j.bookingId===id&&j.kind!=="cancelled"&&j.status==="pending")){
      const current=await tx.get(`housekeepingNotifications/${j.id}`);
      if(current?.status==="pending")tx.set(`housekeepingNotifications/${j.id}`,{status:"stale",supersededAt:now.toISOString()},true);
    }
  });
}
export async function runHousekeepingReminders({now=new Date(),deliver=sendMail,mailerReady=gmailReady(),bookingId=""}={}){
  const settings=configuredReminderSettings(await getPrivateRecord(SETTINGS_PATH)||{});
  if(!settings.enabled||!settings.ready||!settings.activationId||!mailerReady)return {enabled:false,sent:0};
  let records=await listCollectionRecords("housekeepingNotifications");
  await reconcileCancellations(records,settings,now,bookingId);
  records=await listCollectionRecords("housekeepingNotifications");
  const jobs=records.filter(x=>x.status==="pending"&&x.dueAt<=now.toISOString()&&(!bookingId||x.bookingId===bookingId))
    .sort((a,b)=>a.dueAt.localeCompare(b.dueAt)||(noticePriority[a.kind]??9)-(noticePriority[b.kind]??9)).slice(0,30);
  let sent=0;
  for(const job of jobs){
    const claim=await bookingTransaction(async tx=>{
      const current=await tx.get(`housekeepingNotifications/${job.id}`);if(current?.status!=="pending"||current.dueAt>now.toISOString())return null;
      const config=configuredReminderSettings(await tx.get(SETTINGS_PATH)||{});if(!config.enabled||!config.ready)return null;
      const booking=await tx.get(`bookings/${job.bookingId}`);
      const complete=job.kind==="checkout"?await tx.get(`housekeepingReports/${reportId(job.bookingId,job.endDate,job.startDate)}`):null;
      if(!notificationApplicable(current,booking,config,now,complete)){tx.set(`housekeepingNotifications/${job.id}`,{status:"stale",closedAt:now.toISOString()},true);return null;}
      const candidates=[{...current,id:job.id}];
      if(["confirmed","rescheduled"].includes(current.kind))for(const kind of ["pre_arrival","arrival"]){
        const id=`HN${current.revision}-${kind}`,other=await tx.get(`housekeepingNotifications/${id}`);
        if(other?.status==="pending"&&other.dueAt<=now.toISOString()&&notificationApplicable(other,booking,config,now))candidates.push({...other,id});
      }
      const eligible=[];
      for(const candidate of candidates){
        const eventPath=`housekeepingNotificationEvents/${notificationEventKey(candidate)}`,event=await tx.get(eventPath);
        if(event&&["sent","manually_verified","sending","delivery_uncertain"].includes(event.status)){
          tx.set(`housekeepingNotifications/${candidate.id}`,{status:["sent","manually_verified"].includes(event.status)?"suppressed":"held_for_review",previousJobId:event.notificationId},true);
        }else eligible.push({job:candidate,eventPath});
      }
      if(!eligible.length)return null;
      const attemptId=crypto.randomUUID(),attempt={status:"sending",attemptedAt:now.toISOString(),attemptId,combinedNotificationIds:eligible.map(x=>x.job.id)};
      for(const item of eligible){tx.set(`housekeepingNotifications/${item.job.id}`,attempt,true);tx.set(item.eventPath,{...attempt,notificationId:item.job.id},true);}
      tx.set(`housekeepingAudiences/${job.bookingId}`,{activationId:config.activationId,lastAttemptedAt:now.toISOString(),revision:job.revision},true);
      return {booking,config,attemptId,items:eligible};
    });
    if(!claim)continue;
    let status="delivery_uncertain";
    const primary=claim.items[0].job;
    try{await deliver(housekeepingMail({...primary,combinedKinds:claim.items.map(x=>x.job.kind)},{id:job.bookingId,...claim.booking},claim.config));status="sent";sent++;}catch{/* An ambiguous send is never automatically retried. */}
    await bookingTransaction(async tx=>{
      for(const item of claim.items){
        const current=await tx.get(`housekeepingNotifications/${item.job.id}`),event=await tx.get(item.eventPath),patch={status,finishedAt:now.toISOString()};
        if(current?.status==="sending"&&current.attemptId===claim.attemptId)tx.set(`housekeepingNotifications/${item.job.id}`,patch,true);
        if(event?.status==="sending"&&event.attemptId===claim.attemptId)tx.set(item.eventPath,patch,true);
      }
    });
  }
  return {enabled:true,sent};
}
// Called only after the booking transaction commits. A failed callback leaves
// durable pending jobs for the authenticated scheduler; it never fails the order.
export async function triggerHousekeepingBooking(bookingId){
  if(process.env.HOUSEKEEPING_REMINDER_SCHEDULE_READY!=="true"||!process.env.CRON_SECRET)return {enabled:false,sent:0};
  try{return await runHousekeepingReminders({bookingId});}catch{return {enabled:true,sent:0,queued:true};}
}
