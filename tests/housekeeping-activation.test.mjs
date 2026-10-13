import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeFirestore,invoke} from './firestore-fake.mjs';
const fake=installFakeFirestore();
const {configuredReminderSettings,reminderSettings,SETTINGS_PATH,notificationEventKey}=await import('../api/housekeeping-notification-plan.js');
const {setBookingStatus,rescheduleConfirmedBooking}=await import('../api/firestore-admin.js');
const {runHousekeepingReminders,triggerHousekeepingBooking}=await import('../api/housekeeping-notifier.js');
const confirm=(await import('../api/admin-booking-confirm.js')).default;
const change=(await import('../api/admin-booking-reschedule.js')).default;
const now=new Date('2026-11-03T03:30:00Z'),actor={uid:'synthetic-admin'},headers={authorization:'Bearer FAKE'};
const active={...reminderSettings({contactName:'合成房務',email:'staff@example.invalid',arrivalTime:'10:00',checkoutTime:'12:00',preArrivalMinutes:1440}),enabled:true,activationId:'SYNTHETIC-ACTIVATION'};
const stay={id:'SYNTHETIC-LATE',startDate:'2026-11-03',endDate:'2026-11-04',status:'pending',people:12,paidAmount:3000,depositRequired:3000,totalAmount:12000};
const jobs=()=>[...fake.docs].filter(([p])=>p.startsWith('housekeepingNotifications/')).map(([,j])=>j);
test.beforeEach(t=>{
 fake.reset();t.mock.timers.enable({apis:['Date'],now:now.getTime()});delete process.env.HOUSEKEEPING_NOTIFICATIONS_ENABLED;delete process.env.HOUSEKEEPING_NOTIFICATION_ACTIVATION_ID;
 for(const key of ['HOUSEKEEPING_NOTIFICATION_TIMING','CRON_SECRET','HOUSEKEEPING_REMINDER_SCHEDULE_READY'])process.env[key]='';
 fake.set('admins/synthetic-admin',{});fake.authUser={localId:actor.uid,email:'admin@example.invalid'};
});
function setup(){fake.set(SETTINGS_PATH,active);fake.set(`bookings/${stay.id}`,stay);process.env.CRON_SECRET='SYNTHETIC-ONLY';process.env.HOUSEKEEPING_REMINDER_SCHEDULE_READY='true';for(const k of ['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_REFRESH_TOKEN'])process.env[k]='SYNTHETIC-ONLY';process.env.GMAIL_SENDER_EMAIL='owner@example.invalid';}
test('approved production timing remains disabled until secret and scheduler are genuinely ready',()=>{
 process.env.HOUSEKEEPING_NOTIFICATION_TIMING=JSON.stringify({arrivalTime:'10:00',checkoutTime:'12:00',preArrivalMinutes:1440});process.env.HOUSEKEEPING_NOTIFICATIONS_ENABLED='true';process.env.HOUSEKEEPING_NOTIFICATION_ACTIVATION_ID='SYNTHETIC-DEPLOYMENT';
 let s=configuredReminderSettings(active);assert.equal(s.ready,true);assert.equal(s.enabled,false);assert.equal(s.preArrivalMinutes,1440);assert.equal(s.timingManaged,true);
 process.env.CRON_SECRET='SYNTHETIC-ONLY';assert.equal(configuredReminderSettings(active).enabled,false);process.env.HOUSEKEEPING_REMINDER_SCHEDULE_READY='true';assert.equal(configuredReminderSettings(active).enabled,true);
});
test('late confirmation immediately dispatches one combined mail, records both events, and retries send nothing',async()=>{
 setup();const r=await invoke(confirm,{bookingId:stay.id},{headers});assert.equal(r.status,200);assert.equal(fake.gmailMessages.length,1);assert.equal(jobs().filter(j=>j.status==='sent').length,2);assert.equal(jobs().some(j=>j.kind==='pre_arrival'),false);
 const sent=jobs().filter(j=>j.status==='sent');assert.equal(sent[0].attemptId,sent[1].attemptId);for(const j of sent)assert.equal(fake.docs.get(`housekeepingNotificationEvents/${notificationEventKey(j)}`).status,'sent');
 assert.equal(fake.docs.get(`bookings/${stay.id}`).totalAmount,12000);await invoke(confirm,{bookingId:stay.id},{headers});await triggerHousekeepingBooking(stay.id);assert.equal(fake.gmailMessages.length,1);
});
test('confirmation failure does not send; ambiguous immediate delivery does not undo the order or automatically retry',async()=>{
 setup();fake.failCommit=true;assert.equal((await invoke(confirm,{bookingId:stay.id},{headers})).status,400);assert.equal(fake.gmailMessages.length,0);assert.equal(fake.docs.get(`bookings/${stay.id}`).status,'pending');
 fake.failCommit=false;fake.onGmailSend=()=>new Response('{}',{status:503});assert.equal((await invoke(confirm,{bookingId:stay.id},{headers})).status,200);assert.equal(fake.docs.get(`bookings/${stay.id}`).status,'confirmed');assert.equal(jobs().filter(j=>j.status==='delivery_uncertain').length,2);
 await invoke(confirm,{bookingId:stay.id},{headers});assert.equal(fake.gmailMessages.length,1);
});
test('concurrent immediate and scheduled runs claim one combined envelope',async()=>{
 setup();await setBookingStatus(stay.id,'confirmed');let calls=0;await Promise.all([1,2,3].map(()=>runHousekeepingReminders({now,bookingId:stay.id,mailerReady:true,deliver:async()=>{calls++;}})));assert.equal(calls,1);
});
test('date change sends one current change notice and cancellation repairs lost browser callbacks without editing the cancelled order',async()=>{
 setup();await invoke(confirm,{bookingId:stay.id},{headers});const body={bookingId:stay.id,expectedStartDate:stay.startDate,expectedEndDate:stay.endDate,startDate:'2026-11-04',endDate:'2026-11-05'};
 assert.equal((await invoke(change,body,{headers})).status,200);assert.equal(fake.gmailMessages.length,2);assert.equal(jobs().filter(j=>j.kind==='rescheduled'&&j.status==='sent').length,1);
 await invoke(change,body,{headers});assert.equal(fake.gmailMessages.length,2);
 const cancelled={...fake.docs.get(`bookings/${stay.id}`),status:'cancelled',cancellationReason:'PRIVATE-REFUND-REASON'};fake.set(`bookings/${stay.id}`,cancelled);
 const mails=[];await runHousekeepingReminders({now,mailerReady:true,deliver:async m=>mails.push(m)});assert.equal(mails.length,1);assert.match(mails[0].subject,/已取消/);assert.ok(!mails[0].text.includes('PRIVATE-'));assert.deepEqual(fake.docs.get(`bookings/${stay.id}`),cancelled);
 await runHousekeepingReminders({now,mailerReady:true,deliver:async m=>mails.push(m)});assert.equal(mails.length,1);assert.equal(jobs().filter(j=>j.status==='pending').length,0);
});
test('cancellation before any reminder was claimed sends no unnecessary change notice and never backfills an unenrolled stay',async()=>{
 setup();await setBookingStatus(stay.id,'confirmed');await setBookingStatus(stay.id,'cancelled');let count=0;await runHousekeepingReminders({now,mailerReady:true,deliver:async()=>count++});assert.equal(count,0);
 fake.set('bookings/HISTORY',{...stay,id:'HISTORY',status:'confirmed'});await rescheduleConfirmedBooking('HISTORY',{expectedStartDate:stay.startDate,expectedEndDate:stay.endDate,startDate:'2026-11-06',endDate:'2026-11-07'},actor,now);assert.equal(jobs().some(j=>j.bookingId==='HISTORY'),false);
});

test('deployment-managed activation works with an absent Firestore settings document and survives date changes',async()=>{
 setup();fake.docs.delete(SETTINGS_PATH);process.env.HOUSEKEEPING_NOTIFICATION_CONTACT_NAME='合成設定房務';process.env.HOUSEKEEPING_NOTIFICATION_EMAIL='staff@example.invalid';process.env.HOUSEKEEPING_NOTIFICATION_TIMING=JSON.stringify({arrivalTime:'10:00',checkoutTime:'12:00',preArrivalMinutes:1440});process.env.HOUSEKEEPING_NOTIFICATIONS_ENABLED='true';process.env.HOUSEKEEPING_NOTIFICATION_ACTIVATION_ID='SYNTHETIC-DEPLOYMENT';
 const r=await invoke(confirm,{bookingId:stay.id},{headers});assert.equal(r.status,200);assert.equal(fake.docs.get(`bookings/${stay.id}`).housekeepingNotificationActivationId,'SYNTHETIC-DEPLOYMENT');assert.equal(fake.gmailMessages.length,1);
 await invoke(change,{bookingId:stay.id,expectedStartDate:stay.startDate,expectedEndDate:stay.endDate,startDate:'2026-11-04',endDate:'2026-11-05'},{headers});assert.equal(fake.gmailMessages.length,2);assert.ok(jobs().some(j=>j.kind==='rescheduled'&&j.status==='sent'));
});
