import {bookingTransaction,listCollectionRecords} from "./firestore-admin.js";
import {SETTINGS_PATH,stayKey,notificationEventKey} from "./housekeeping-notification-plan.js";
import {reportId} from "./housekeeping-records.js";
const reviewable=new Set(["delivery_uncertain","sending","held_for_review"]);
export async function notificationSummaries(month){
  const [jobs,bookings]=await Promise.all([listCollectionRecords("housekeepingNotifications"),listCollectionRecords("bookings")]);
  const byId=new Map(bookings.map(b=>[b.id,b]));
  return jobs.filter(j=>reviewable.has(j.status)||String(j.startDate).startsWith(month)||String(j.endDate).startsWith(month)).map(j=>{
    const b=byId.get(j.bookingId),effectiveStale=!b||b.status!=="confirmed"||stayKey(b)!==j.revision||Boolean(j.supersededAt);
    const {id,bookingId,startDate,endDate,kind,status,dueAt,attemptId="",attemptedAt="",finishedAt="",reviewedAt="",reviewedBy="",previousJobId="",reviewCount=0}=j;
    return {id,bookingId,startDate,endDate,kind,status,dueAt,attemptId,attemptedAt,finishedAt,reviewedAt,reviewedBy,previousJobId,reviewCount,effectiveStale};
  }).sort((a,b)=>Number(reviewable.has(b.status))-Number(reviewable.has(a.status))||String(b.attemptedAt||b.dueAt).localeCompare(String(a.attemptedAt||a.dueAt)));
}
export async function reviewHousekeepingNotification(input,actor,now=new Date()){
  const {notificationId,requestId,action}=input;
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(notificationId||"")||!/^[A-Za-z0-9_-]{10,120}$/.test(requestId||"")||!["verify_delivery","requeue_notification"].includes(action))throw new Error("INVALID_NOTIFICATION_REVIEW");
  return bookingTransaction(async tx=>{
    const path=`housekeepingNotifications/${notificationId}`,job=await tx.get(path);if(!job)throw new Error("NOTIFICATION_NOT_FOUND");
    if(job.lastReviewRequestId===requestId)return {id:notificationId,...job,duplicate:true};
    if(!reviewable.has(job.status)||String(job.attemptId||"")!==String(input.attemptId||""))throw new Error("NOTIFICATION_REVIEW_CHANGED");
    const eventPath=`housekeepingNotificationEvents/${notificationEventKey(job)}`,event=await tx.get(eventPath);
    const history=[...(job.reviewHistory||[])],patch={reviewedBy:actor.uid,reviewedAt:now.toISOString(),reviewCount:(Number(job.reviewCount)||0)+1,lastReviewRequestId:requestId};
    if(action==="verify_delivery"){
      if(input.verified!==true)throw new Error("VERIFICATION_REQUIRED");patch.status="manually_verified";
    }else{
      if(input.possibleDuplicateAck!==true)throw new Error("DUPLICATE_ACK_REQUIRED");
      if(event?.status==="sending"&&(!Number.isFinite(Date.parse(event.attemptedAt||""))||now.getTime()-Date.parse(event.attemptedAt)<15*60*1000))throw new Error("NOTIFICATION_STILL_IN_FLIGHT");
      if(job.status==="sending"&&(!Number.isFinite(Date.parse(job.attemptedAt||""))||now.getTime()-Date.parse(job.attemptedAt)<15*60*1000))throw new Error("NOTIFICATION_STILL_IN_FLIGHT");
      const config=await tx.get(SETTINGS_PATH),b=await tx.get(`bookings/${job.bookingId}`);
      const completed=job.kind==="checkout"?await tx.get(`housekeepingReports/${reportId(job.bookingId,job.endDate,job.startDate)}`):null;
      const day=job.kind==="checkout"?job.endDate:job.startDate,today=now.toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"});
      if(!config?.enabled)throw new Error("REMINDERS_DISABLED");
      if(!b||b.isTest||b.status!=="confirmed"||stayKey({id:job.bookingId,...b})!==job.revision||config.activationId!==job.activationId||job.supersededAt||completed?.status==="completed"||day<today)throw new Error("NOTIFICATION_NO_LONGER_APPLICABLE");
      patch.status="pending";patch.dueAt=now.toISOString();patch.attemptId="";
    }
    history.push({action,requestId,actor:actor.uid,at:now.toISOString(),previousStatus:job.status,previousAttemptId:job.attemptId||"",possibleDuplicateAck:input.possibleDuplicateAck===true});patch.reviewHistory=history.slice(-50);
    tx.set(eventPath,{status:patch.status,notificationId,attemptId:patch.attemptId??job.attemptId??"",reviewedAt:now.toISOString()},true);
    tx.set(path,patch,true);return {id:notificationId,...job,...patch,duplicate:false};
  });
}
