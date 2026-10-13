import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeFirestore,invoke} from './firestore-fake.mjs';
const fake=installFakeFirestore();
const {configuredReminderSettings,reminderSettings,newConfirmationJobs,housekeepingMail,SETTINGS_PATH,notificationEventKey}=await import('../api/housekeeping-notification-plan.js');
const {setBookingStatus,rescheduleConfirmedBooking}=await import('../api/firestore-admin.js');
const {runHousekeepingReminders}=await import('../api/housekeeping-notifier.js');
const calendar=(await import('../api/housekeeping-calendar.js')).default;
const admin=(await import('../api/admin-housekeeping.js')).default;
const cron=(await import('../api/housekeeping-reminders.js')).default;
const {newBookingNotificationRecipients}=await import('../api/gmail-mailer.js');
const now=new Date('2026-10-10T00:00:00Z');
const stay={id:'SYNTHETIC-PREPARATION',startDate:'2026-10-12',endDate:'2026-10-14',people:12,status:'confirmed',paidAmount:3000,depositRequired:3000};
const active={...reminderSettings({contactName:'合成房務',email:'staff@example.invalid',arrivalTime:'09:00',checkoutTime:'12:00',preArrivalMinutes:1440}),enabled:true,activationId:'SYNTHETIC-ACTIVE'};
const rows=()=>[...fake.docs].filter(([key])=>key.startsWith('housekeepingNotifications/')).map(([,value])=>value);
test.beforeEach(t=>{fake.reset();t.mock.timers.enable({apis:['Date'],now:now.getTime()});for(const key of ['HOUSEKEEPING_NOTIFICATION_EMAIL','HOUSEKEEPING_NOTIFICATION_CONTACT_NAME','CRON_SECRET','HOUSEKEEPING_REMINDER_SCHEDULE_READY'])process.env[key]='';});
function configure(){process.env.HOUSEKEEPING_NOTIFICATION_EMAIL='configured-staff@example.invalid';process.env.HOUSEKEEPING_NOTIFICATION_CONTACT_NAME='合成設定房務';}
test('ordinary recipient configuration preserves schedule and activation without granting recipient access or replacing admin/new-order recipients',async()=>{
  configure();const result=configuredReminderSettings(active);assert.equal(result.email,'configured-staff@example.invalid');assert.equal(result.contactManaged,true);assert.equal(result.arrivalTime,active.arrivalTime);assert.equal(result.checkoutTime,active.checkoutTime);assert.equal(result.preArrivalMinutes,1440);assert.equal(result.activationId,active.activationId);
  process.env.ADMIN_NOTIFICATION_EMAIL='owner@example.invalid';process.env.NEW_BOOKING_NOTIFICATION_EXTRA_EMAIL='second@example.invalid';assert.deepEqual(newBookingNotificationRecipients(),['owner@example.invalid','second@example.invalid']);
  fake.authUser={localId:'synthetic-new-recipient',email:result.email};assert.equal((await invoke(calendar,null,{method:'GET',query:{month:'2026-10'},headers:{authorization:'Bearer FAKE'}})).status,403);assert.equal(fake.docs.size,0);
});
test('admin reads configured contact and unknown timing explicitly; saving remains disabled and cannot accept injected activation metadata',async()=>{
  configure();fake.authUser={localId:'synthetic-admin'};fake.set('admins/synthetic-admin',{});
  const request={method:'GET',query:{month:'2026-10'},headers:{authorization:'Bearer FAKE'}};
  const read=await invoke(admin,null,request);assert.equal(read.status,200);assert.equal(read.data.settings.email,'configured-staff@example.invalid');assert.equal(read.data.settings.enabled,false);assert.equal(read.data.settings.ready,false);assert.equal(read.data.settings.preArrivalMinutes,null);assert.equal(read.data.settings.arrivalTime,'');assert.equal(read.data.settings.checkoutTime,'');
  const saved=await invoke(admin,{...active,activationId:'INJECTED',enabled:true,contactManaged:false},{headers:request.headers});assert.equal(saved.status,200);assert.equal(saved.data.settings.enabled,false);assert.equal(saved.data.settings.activationId,undefined);assert.equal(saved.data.settings.contactManaged,true);
  assert.equal((await invoke(admin,{...active,activate:true},{headers:request.headers})).status,400);assert.equal((await invoke(cron,null,{method:'GET'})).status,503);assert.equal(rows().length,0);assert.equal(fake.gmailMessages.length,0);
});
test('missing timing cannot activate a worker or backfill historical confirmations; only approved offsets are planned',async()=>{
  configure();const missing={...active,preArrivalMinutes:null};fake.set(SETTINGS_PATH,missing);assert.equal(configuredReminderSettings(missing).ready,false);assert.deepEqual(newConfirmationJobs(stay,missing,now),[]);
  let calls=0;assert.equal((await runHousekeepingReminders({now,mailerReady:true,deliver:async()=>calls++})).enabled,false);assert.equal(calls,0);assert.ok(!fake.calls.some(c=>c.url.endsWith('/housekeepingNotifications?pageSize=500')));
  fake.set(`bookings/${stay.id}`,stay);fake.set(SETTINGS_PATH,active);await setBookingStatus(stay.id,'confirmed');assert.equal(rows().length,0);
  for(const value of [-1,0,0.5,'NaN',43201])assert.throws(()=>reminderSettings({...active,preArrivalMinutes:value}),/INVALID_PRE_ARRIVAL_OFFSET/);
});
test('four events use existing stay times and explicit Taipei offset; previous-day preparation expires on its own day',async()=>{
  const jobs=newConfirmationJobs(stay,active,now);assert.deepEqual(jobs.map(j=>j.kind),['confirmed','pre_arrival','arrival','checkout']);
  const prep=jobs.find(j=>j.kind==='pre_arrival');assert.equal(prep.dueAt,'2026-10-11T07:00:00.000Z');assert.equal(jobs.find(j=>j.kind==='arrival').dueAt,'2026-10-12T01:00:00.000Z');assert.equal(jobs.find(j=>j.kind==='checkout').dueAt,'2026-10-14T04:00:00.000Z');
  assert.equal(notificationEventKey(prep),notificationEventKey({...prep,dueAt:'2026-10-12T01:00:00Z'}));
  fake.set(SETTINGS_PATH,active);fake.set(`bookings/${stay.id}`,stay);fake.set(`housekeepingNotifications/${prep.id}`,prep);let sent=0;
  await runHousekeepingReminders({now:new Date('2026-10-12T00:00:00Z'),mailerReady:true,deliver:async()=>sent++});assert.equal(sent,0);assert.equal(fake.docs.get(`housekeepingNotifications/${prep.id}`).status,'stale');
});
test('confirmed/preparation/arrival/checkout mail contains only work fields and login link, never guest contact, arbitrary notes or payment data',()=>{
  const privateStay={...stay,guestName:'PRIVATE-NAME',phone:'PRIVATE-PHONE',email:'private-customer@example.invalid',notes:'PRIVATE-LOCK-CODE',housekeepingNote:'PRIVATE-ACCOUNT-NOTE',totalAmount:987654,transferLast5:'99887'};
  for(const job of newConfirmationJobs(stay,active,now)){
    const mail=housekeepingMail(job,privateStay,active);assert.match(mail.text,/訂單 SYNTHETIC-PREPARATION/);assert.match(mail.text,/15:00/);assert.match(mail.text,/12:00/);assert.match(mail.text,/12 位/);assert.match(mail.text,/Asia\/Taipei/);assert.match(mail.text,/https:\/\/www\.5-1bbs\.com\/housekeeping\/\?date=/);assert.match(mail.text,/已授權/);
    for(const marker of ['PRIVATE-','private-customer','987654','99887','3000'])assert.ok(!mail.text.includes(marker));
    if(job.kind!=='checkout')assert.match(mail.text,/回傳官方 LINE @287ppyfa/);else assert.match(mail.text,/至少拍一張客廳/);
  }
});
test('configured recipient is applied to actual isolated worker output, simultaneous runners deduplicate preparation and reversal does not resend it',async()=>{
  configure();fake.set(SETTINGS_PATH,active);fake.set(`bookings/${stay.id}`,{...stay,status:'pending'});await setBookingStatus(stay.id,'confirmed');const mails=[];
  const due=new Date('2026-10-11T07:00:00Z');await Promise.all([1,2].map(()=>runHousekeepingReminders({now:due,mailerReady:true,deliver:async mail=>mails.push(mail)})));assert.equal(mails.length,2);assert.ok(mails.every(m=>m.to==='configured-staff@example.invalid'));
  const actor={uid:'synthetic-admin'};await rescheduleConfirmedBooking(stay.id,{expectedStartDate:stay.startDate,expectedEndDate:stay.endDate,startDate:'2026-10-13',endDate:'2026-10-15'},actor,due);
  await rescheduleConfirmedBooking(stay.id,{expectedStartDate:'2026-10-13',expectedEndDate:'2026-10-15',startDate:stay.startDate,endDate:stay.endDate},actor,due);
  assert.ok(rows().some(j=>j.kind==='pre_arrival'&&j.status==='suppressed'));await runHousekeepingReminders({now:due,mailerReady:true,deliver:async mail=>mails.push(mail)});assert.equal(mails.length,2);
});
test('staff calendar excludes inquiries and guest private fields while retaining work identity, dates, headcount and completion',async()=>{
  fake.authUser={localId:'synthetic-staff',email:'51bbsadmin@gmail.com'};fake.set(`bookings/${stay.id}`,{...stay,guestName:'PRIVATE-NAME',phone:'PRIVATE-PHONE',email:'PRIVATE-EMAIL',notes:'PRIVATE-NOTE',totalAmount:99999});fake.set('bookings/INQUIRY',{...stay,id:'INQUIRY',status:'pending'});
  const result=await invoke(calendar,null,{method:'GET',query:{month:'2026-10'},headers:{authorization:'Bearer FAKE'}});assert.equal(result.status,200);assert.equal(result.data.bookings.length,1);assert.deepEqual(Object.keys(result.data.bookings[0]).sort(),['id','startDate','endDate','people','status','housekeepingReport'].sort());assert.equal(result.data.bookings[0].people,12);assert.ok(!JSON.stringify(result.data).includes('PRIVATE-'));
});

test('same-day preparation cannot send or be newly planned at or after the established check-in time',async()=>{
  const settings={...active,preArrivalMinutes:60},prep=newConfirmationJobs(stay,settings,now).find(j=>j.kind==='pre_arrival'),after=new Date('2026-10-12T07:00:00Z');
  assert.ok(!newConfirmationJobs(stay,settings,after).some(j=>j.kind==='pre_arrival'));
  fake.set(SETTINGS_PATH,settings);fake.set(`bookings/${stay.id}`,stay);fake.set(`housekeepingNotifications/${prep.id}`,prep);let calls=0;
  await runHousekeepingReminders({now:after,mailerReady:true,deliver:async()=>calls++});assert.equal(calls,0);assert.equal(fake.docs.get(`housekeepingNotifications/${prep.id}`).status,'stale');
});
