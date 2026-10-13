import crypto from "node:crypto";
import {bookingTransaction,getPrivateRecord,listCollectionRecords} from "./firestore-admin.js";
import {SETTINGS_PATH,stayKey,housekeepingMail,notificationEventKey,notificationExpired,configuredReminderSettings} from "./housekeeping-notification-plan.js";
import {reportId} from "./housekeeping-records.js";
import {gmailReady,sendMail} from "./gmail-mailer.js";

// This worker is deliberately not scheduled by this change. Claims are
// at-most-once: an uncertain Gmail result is never automatically sent again.
export async function runHousekeepingReminders({now=new Date(),deliver=sendMail,mailerReady=gmailReady()}={}){
  const settings=configuredReminderSettings(await getPrivateRecord(SETTINGS_PATH)||{});
  if(!settings?.enabled||!settings.ready||!settings.activationId||!mailerReady)return {enabled:false,sent:0};
  const jobs=(await listCollectionRecords("housekeepingNotifications")).filter(x=>x.status==="pending"&&x.dueAt<=now.toISOString()).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,20);let sent=0;
  for(const job of jobs){
    const claim=await bookingTransaction(async tx=>{
      const current=await tx.get(`housekeepingNotifications/${job.id}`);if(current?.status!=="pending"||current.dueAt>now.toISOString())return null;
      const config=configuredReminderSettings(await tx.get(SETTINGS_PATH)||{});if(!config?.enabled||!config.ready)return null;
      const booking=await tx.get(`bookings/${job.bookingId}`);
      const complete=job.kind==="checkout"?await tx.get(`housekeepingReports/${reportId(job.bookingId,job.endDate,job.startDate)}`):null;
      if(!booking||booking.isTest||booking.status!=="confirmed"||stayKey({id:job.bookingId,...booking})!==job.revision||config.activationId!==job.activationId||complete?.status==="completed"||notificationExpired(job,now)){tx.set(`housekeepingNotifications/${job.id}`,{status:"stale",closedAt:now.toISOString()},true);return null;}
      const eventPath=`housekeepingNotificationEvents/${notificationEventKey(job)}`,event=await tx.get(eventPath);
      if(event&&["sent","manually_verified","sending","delivery_uncertain"].includes(event.status)){tx.set(`housekeepingNotifications/${job.id}`,{status:["sent","manually_verified"].includes(event.status)?"suppressed":"held_for_review",previousJobId:event.notificationId},true);return null;}
      const attemptId=crypto.randomUUID(),attempt={status:"sending",attemptedAt:now.toISOString(),attemptId};tx.set(`housekeepingNotifications/${job.id}`,attempt,true);tx.set(eventPath,{...attempt,notificationId:job.id},true);return {booking,config,attemptId,eventPath};
    });
    if(!claim)continue;
    let status="delivery_uncertain";
    try{await deliver(housekeepingMail(job,{id:job.bookingId,...claim.booking},claim.config));status="sent";sent++;}catch{/* Never retry an ambiguous send and risk duplicate staff emails. */}
    await bookingTransaction(async tx=>{const current=await tx.get(`housekeepingNotifications/${job.id}`),event=await tx.get(claim.eventPath),patch={status,finishedAt:now.toISOString()};if(current?.status==="sending"&&current.attemptId===claim.attemptId)tx.set(`housekeepingNotifications/${job.id}`,patch,true);if(event?.status==="sending"&&event.attemptId===claim.attemptId)tx.set(claim.eventPath,patch,true);});
  }
  return {enabled:true,sent};
}
