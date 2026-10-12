import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeFirestore,invoke} from './firestore-fake.mjs';
const fake=installFakeFirestore();
const {setBookingStatus,rescheduleConfirmedBooking}=await import('../api/firestore-admin.js');
const {SETTINGS_PATH,reminderSettings,stayKey,notificationEventKey}=await import('../api/housekeeping-notification-plan.js');
const {runHousekeepingReminders}=await import('../api/housekeeping-notifier.js');
const {reviewHousekeepingNotification,notificationSummaries}=await import('../api/housekeeping-notification-review.js');
const adminHandler=(await import('../api/admin-housekeeping.js')).default;
const rescheduleHandler=(await import('../api/admin-booking-reschedule.js')).default;
const actor={uid:'synthetic-admin'},now=new Date('2026-10-10T00:00:00Z');
const active={...reminderSettings({contactName:'合成房務',email:'synthetic@example.invalid',arrivalTime:'09:00',checkoutTime:'12:00'}),enabled:true,activationId:'ACTIVATION'};
const booking={id:'SYNTHETIC-CHANGE',startDate:'2026-10-11',endDate:'2026-10-13',status:'pending',people:12,paidAmount:3000,depositRequired:3000,totalAmount:12000};
const list=()=>[...fake.docs].filter(([p])=>p.startsWith('housekeepingNotifications/')).map(([p,b])=>({id:p.split('/')[1],...b}));
const jobs=(status='pending')=>list().filter(j=>j.status===status);
const read=()=>fake.docs.get(`bookings/${booking.id}`);
function body(startDate='2026-10-12',endDate='2026-10-14',before=booking){return {startDate,endDate,expectedStartDate:before.startDate,expectedEndDate:before.endDate};}
async function seed(enabled=true){fake.set(SETTINGS_PATH,{...active,enabled});fake.set(`bookings/${booking.id}`,booking);await setBookingStatus(booking.id,'confirmed');}
test.beforeEach(context=>{fake.reset();context.mock.timers.enable({apis:['Date'],now:now.getTime()});});
test('confirmation, concurrent date change retries and cancellation keep locks, status and reminder jobs atomic',async()=>{
 await seed();const finance={paidAmount:read().paidAmount,totalAmount:read().totalAmount};
 const change=body();const [a,b]=await Promise.all([rescheduleConfirmedBooking(booking.id,change,actor,now),rescheduleConfirmedBooking(booking.id,change,actor,now)]);
 assert.equal(a.housekeepingRevision,b.housekeepingRevision);assert.equal(jobs().length,3);assert.equal(jobs('stale').length,3);assert.equal(read().status,'confirmed');
 assert.equal(fake.docs.has('availability/2026-10-11'),false);assert.equal(fake.docs.get('availability/2026-10-13').bookingId,booking.id);assert.deepEqual({paidAmount:read().paidAmount,totalAmount:read().totalAmount},finance);
 await setBookingStatus(booking.id,'cancelled');assert.equal(jobs().length,0);assert.equal(fake.docs.has('availability/2026-10-13'),false);
 let sends=0;await runHousekeepingReminders({now:new Date('2026-10-14T05:00:00Z'),mailerReady:true,deliver:async()=>sends++});assert.equal(sends,0);
});
test('conflicts, failed commits and cancelled state never apply a partial date or reminder change',async()=>{
 await seed();await assert.rejects(rescheduleConfirmedBooking(booking.id,body('2026-02-31','2026-03-04'),actor,now),/INVALID_DATES/);const before=structuredClone(fake.docs);fake.set('availability/2026-10-13',{status:'booked',bookingId:'OTHER'});
 await assert.rejects(rescheduleConfirmedBooking(booking.id,body(),actor,now),/DATE_CONFLICT/);assert.equal(read().startDate,booking.startDate);assert.equal(jobs().length,3);
 fake.set('availability/2026-10-13',{status:'available'});fake.failCommit=true;await assert.rejects(rescheduleConfirmedBooking(booking.id,body(),actor,now));assert.equal(read().startDate,booking.startDate);assert.equal(jobs('stale').length,0);
 fake.failCommit=false;await setBookingStatus(booking.id,'cancelled');await assert.rejects(rescheduleConfirmedBooking(booking.id,body(),actor,now),/NOT_CONFIRMED/);assert.equal(before.get(`bookings/${booking.id}`).totalAmount,read().totalAmount);
});
test('lost change reply retries are idempotent; no-op date edits create no jobs or revision',async()=>{
 await seed();fake.dropCommitResponse=true;await assert.rejects(rescheduleConfirmedBooking(booking.id,body(),actor,now),/REPLY_LOST/);
 const retry=await rescheduleConfirmedBooking(booking.id,body(),actor,now);assert.equal(retry.duplicate,true);assert.equal(jobs().length,3);
 const current=read(),revision=current.housekeepingRevision;await rescheduleConfirmedBooking(booking.id,{...body(current.startDate,current.endDate,current),notes:'合成備註'},actor,now);assert.equal(read().housekeepingRevision,revision);assert.equal(jobs().length,3);
});
test('disabled confirmations and enabling later never backfill reminders when an old stay changes dates',async()=>{
 await seed(false);assert.equal(list().length,0);await rescheduleConfirmedBooking(booking.id,body(),actor,now);assert.equal(list().length,0);
 fake.set(SETTINGS_PATH,active);const current=read();await rescheduleConfirmedBooking(booking.id,body('2026-10-13','2026-10-15',current),actor,now);assert.equal(list().length,0);
});
test('same-day arrival changes, date reversals and already sent confirmation never send twice automatically',async()=>{
 await seed();let sent=0;await runHousekeepingReminders({now:new Date('2026-10-11T01:00:00Z'),mailerReady:true,deliver:async()=>sent++});assert.equal(sent,2);
 await rescheduleConfirmedBooking(booking.id,body('2026-10-11','2026-10-14'),actor,now);assert.equal(jobs('suppressed').filter(j=>j.kind==='arrival').length,1);assert.equal(jobs().some(j=>j.kind==='confirmed'),false);
 let current=read();await rescheduleConfirmedBooking(booking.id,body('2026-10-12','2026-10-14',current),actor,now);current=read();await rescheduleConfirmedBooking(booking.id,body('2026-10-11','2026-10-13',current),actor,now);
 await runHousekeepingReminders({now:new Date('2026-10-11T02:00:00Z'),mailerReady:true,deliver:async()=>sent++});assert.equal(sent,2);assert.ok(jobs('suppressed').filter(j=>j.kind==='arrival').length>=2);
});
test('same-day ambiguous delivery is held for review after change instead of silently resent',async()=>{
 await seed();await runHousekeepingReminders({now:new Date('2026-10-11T01:00:00Z'),mailerReady:true,deliver:async()=>{throw new Error('SYNTHETIC_UNKNOWN');}});
 await rescheduleConfirmedBooking(booking.id,body('2026-10-11','2026-10-14'),actor,now);assert.equal(jobs('held_for_review').filter(j=>j.kind==='arrival').length,1);
 const summaries=await notificationSummaries('2026-10');assert.ok(summaries.some(j=>j.status==='delivery_uncertain'&&j.effectiveStale));let sends=0;await runHousekeepingReminders({now:new Date('2026-10-11T02:00:00Z'),mailerReady:true,deliver:async()=>sends++});assert.equal(sends,0);
});
test('manual review records operator and history without sending; lost response and repeated review are idempotent',async()=>{
 await seed();const job=jobs().find(j=>j.kind==='arrival');fake.set(`housekeepingNotifications/${job.id}`,{...job,status:'delivery_uncertain',attemptId:'TRY'});
 const input={notificationId:job.id,action:'verify_delivery',requestId:'SYNTHETIC-REVIEW-001',attemptId:'TRY',verified:true};fake.dropCommitResponse=true;await assert.rejects(reviewHousekeepingNotification(input,actor,now));
 const retry=await reviewHousekeepingNotification(input,actor,now);assert.equal(retry.duplicate,true);assert.equal(retry.status,'manually_verified');assert.equal(retry.reviewHistory.length,1);assert.equal(retry.reviewedBy,actor.uid);
});
test('manual retry needs duplicate acknowledgement, current stay, enabled config and a quiet in-flight window',async()=>{
 await seed();const job=jobs().find(j=>j.kind==='arrival'),input={notificationId:job.id,action:'requeue_notification',requestId:'SYNTHETIC-RETRY-001',attemptId:'TRY',possibleDuplicateAck:true};
 fake.set(`housekeepingNotifications/${job.id}`,{...job,status:'delivery_uncertain',attemptId:'TRY'});
 await assert.rejects(reviewHousekeepingNotification({...input,possibleDuplicateAck:false},actor,now),/DUPLICATE_ACK/);
 fake.set(SETTINGS_PATH,{...active,enabled:false});await assert.rejects(reviewHousekeepingNotification(input,actor,now),/DISABLED/);fake.set(SETTINGS_PATH,active);
 fake.set(`housekeepingNotifications/${job.id}`,{...job,status:'sending',attemptId:'TRY',attemptedAt:now.toISOString()});await assert.rejects(reviewHousekeepingNotification(input,actor,now),/IN_FLIGHT/);
 const later=new Date(now.getTime()+16*60*1000);const result=await reviewHousekeepingNotification(input,actor,later);assert.equal(result.status,'pending');assert.equal(result.reviewHistory[0].possibleDuplicateAck,true);
 assert.equal((await reviewHousekeepingNotification(input,actor,later)).duplicate,true);
 fake.set(`housekeepingNotifications/${job.id}`,{...job,status:'delivery_uncertain',attemptId:'TRY'});await setBookingStatus(booking.id,'cancelled');await assert.rejects(reviewHousekeepingNotification({...input,requestId:'SYNTHETIC-RETRY-002'},actor,later),/NO_LONGER/);
});
test('only an existing admin may read notification states, review or change confirmed dates',async()=>{
 const denied=await invoke(adminHandler,null,{method:'GET',query:{month:'2026-10'}});assert.equal(denied.status,401);
 const changed=await invoke(rescheduleHandler,{bookingId:booking.id,...body()});assert.equal(changed.status,401);assert.equal(fake.calls.length,0);
 fake.authUser={localId:'stranger',email:'stranger@example.invalid'};assert.equal((await invoke(adminHandler,{action:'verify_delivery'},{headers:{authorization:'Bearer FAKE'}})).status,403);
});
test('an old worker finishing after an explicit retry cannot overwrite the newer attempt result',async()=>{
 await seed();const deliveryTime=new Date('2026-10-11T01:00:00Z');let release,started;const running=new Promise(r=>started=r),blocked=new Promise(r=>release=r);
 const first=runHousekeepingReminders({now:deliveryTime,mailerReady:true,deliver:async()=>{started();await blocked;}});await running;
 const job=list().find(j=>j.status==='sending');const later=new Date(deliveryTime.getTime()+16*60*1000);
 await reviewHousekeepingNotification({notificationId:job.id,attemptId:job.attemptId,action:'requeue_notification',requestId:'SYNTHETIC-LATE-RETRY',possibleDuplicateAck:true},actor,later);
 await runHousekeepingReminders({now:later,mailerReady:true,deliver:async()=>{}});const newer=structuredClone(fake.docs.get(`housekeepingNotifications/${job.id}`));release();await first;
 assert.equal(fake.docs.get(`housekeepingNotifications/${job.id}`).attemptId,newer.attemptId);assert.equal(fake.docs.get(`housekeepingNotifications/${job.id}`).status,'sent');assert.equal(fake.docs.get(`housekeepingNotificationEvents/${notificationEventKey(job)}`).attemptId,newer.attemptId);
});
