import {bookingTransaction,getPrivateRecord,listCollectionRecords} from "./firestore-admin.js";
import {SETTINGS_PATH,stayKey,housekeepingMail} from "./housekeeping-notification-plan.js";
import {reportId} from "./housekeeping-records.js";
import {gmailReady,sendMail} from "./gmail-mailer.js";

// This worker is deliberately not scheduled by this change. Claims are
// at-most-once: an uncertain Gmail result is never automatically sent again.
export async function runHousekeepingReminders({now=new Date(),deliver=sendMail,mailerReady=gmailReady()}={}){
  const settings=await getPrivateRecord(SETTINGS_PATH);
  if(!settings?.enabled||!settings.activationId||!mailerReady)return {enabled:false,sent:0};
  const jobs=(await listCollectionRecords("housekeepingNotifications")).filter(x=>x.status==="pending"&&x.dueAt<=now.toISOString()).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,20);let sent=0;
  for(const job of jobs){
    const claim=await bookingTransaction(async tx=>{
      const current=await tx.get(`housekeepingNotifications/${job.id}`);if(current?.status!=="pending")return null;
      const config=await tx.get(SETTINGS_PATH);if(!config?.enabled)return null;
      const booking=await tx.get(`bookings/${job.bookingId}`);
      const complete=job.kind==="checkout"?await tx.get(`housekeepingReports/${reportId(job.bookingId,job.endDate,job.startDate)}`):null;
      const today=now.toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"}),day=job.kind==="checkout"?job.endDate:job.startDate;
      if(!booking||booking.isTest||booking.status!=="confirmed"||stayKey({id:job.bookingId,...booking})!==job.revision||config.activationId!==job.activationId||complete?.status==="completed"||day<today){tx.set(`housekeepingNotifications/${job.id}`,{status:"stale",closedAt:now.toISOString()},true);return null;}
      tx.set(`housekeepingNotifications/${job.id}`,{status:"sending",attemptedAt:now.toISOString()},true);return {booking,config};
    });
    if(!claim)continue;
    let status="delivery_uncertain";
    try{await deliver(housekeepingMail(job,{id:job.bookingId,...claim.booking},claim.config));status="sent";sent++;}catch{/* Never retry an ambiguous send and risk duplicate staff emails. */}
    await bookingTransaction(async tx=>{const current=await tx.get(`housekeepingNotifications/${job.id}`);if(current?.status==="sending")tx.set(`housekeepingNotifications/${job.id}`,{status,finishedAt:now.toISOString()},true);});
  }
  return {enabled:true,sent};
}
