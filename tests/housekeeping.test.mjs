import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installFakeFirestore,invoke} from './firestore-fake.mjs';
const fake=installFakeFirestore();
const {uploadHousekeepingPhoto,completeHousekeeping,reportId,MAX_PHOTO_BYTES}=await import('../api/housekeeping-records.js');
const {setBookingStatus}=await import('../api/firestore-admin.js');
const {newConfirmationJobs,reminderSettings,SETTINGS_PATH,housekeepingMail}=await import('../api/housekeeping-notification-plan.js');
const {runHousekeepingReminders}=await import('../api/housekeeping-notifier.js');
const photoHandler=(await import('../api/housekeeping-photo.js')).default;
const calendarHandler=(await import('../api/housekeeping-calendar.js')).default;
const settingsHandler=(await import('../api/admin-housekeeping.js')).default;
const cronHandler=(await import('../api/housekeeping-reminders.js')).default;
const photoBase64=(await readFile(new URL('./fixtures/synthetic-room.jpg',import.meta.url))).toString('base64');
const now=new Date('2026-10-10T04:00:00Z'),actor={uid:'synthetic-housekeeper',email:'51bbsadmin@gmail.com'};
const stay={id:'SYNTHETIC-A',startDate:'2026-10-09',endDate:'2026-10-10',guestName:'合成旅客',status:'confirmed',people:1,paidAmount:3000,depositRequired:3000};
const input={bookingId:stay.id,startDate:stay.startDate,checkoutDate:stay.endDate,requestId:'SYNTHETIC-REQUEST-001',photoBase64};
const activeSettings={...reminderSettings({contactName:'合成房務',email:'synthetic@example.invalid',arrivalTime:'09:00',checkoutTime:'12:00',preArrivalMinutes:60}),enabled:true,activationId:'SYNTHETIC-ACTIVATION'};
test.beforeEach(()=>{fake.reset();fake.authUser={localId:actor.uid,email:actor.email};process.env.CRON_SECRET='';process.env.HOUSEKEEPING_REMINDER_SCHEDULE_READY='';});
function seed(){fake.set(`bookings/${stay.id}`,stay);}
function count(collection){return [...fake.docs.keys()].filter(x=>x.startsWith(collection+'/')).length;}
test('private photo upload is bounded, independently stored, and idempotent without changing orders or finance',async()=>{
  seed();const before=structuredClone(fake.docs.get(`bookings/${stay.id}`));const [a,b]=await Promise.all([uploadHousekeepingPhoto(input,actor,now),uploadHousekeepingPhoto(input,actor,now)]);
  assert.equal(a.id,b.id);assert.equal(count('housekeepingPhotos'),1);assert.deepEqual(fake.docs.get(`bookings/${stay.id}`),before);assert.equal(count('paymentTransactions'),0);
  assert.ok(fake.docs.get(`housekeepingPhotos/${a.id}`).size<MAX_PHOTO_BYTES);
});
test('photo failure never records completed; retry after lost commit response reuses the saved photo',async()=>{
  seed();fake.failCommit=true;await assert.rejects(uploadHousekeepingPhoto(input,actor,now));assert.equal(count('housekeepingPhotos'),0);assert.equal(count('housekeepingReports'),0);
  fake.failCommit=false;fake.dropCommitResponse=true;await assert.rejects(uploadHousekeepingPhoto(input,actor,now),/REPLY_LOST/);
  const retry=await uploadHousekeepingPhoto(input,actor,now);assert.equal(retry.duplicate,true);assert.equal(count('housekeepingPhotos'),1);
});
test('completion requires that exact stay photo; duplicates preserve first operator, time and photo',async()=>{
  seed();const uploaded=await uploadHousekeepingPhoto(input,actor,now),body={bookingId:stay.id,startDate:stay.startDate,checkoutDate:stay.endDate,photoId:uploaded.id,cleaned:true,note:'合成清潔完成'};
  const [a,b]=await Promise.all([completeHousekeeping(body,actor,now),completeHousekeeping(body,actor,new Date(now.getTime()+1000))]);assert.equal(a.id,b.id);assert.equal(a.completedAt,b.completedAt);assert.equal(count('housekeepingReports'),1);
  const record=fake.docs.get(`housekeepingReports/${reportId(stay.id,stay.endDate,stay.startDate)}`);assert.equal(record.photoId,uploaded.id);assert.equal(record.completedBy,actor.uid);assert.equal(record.completedByEmail,actor.email);assert.ok(!('base64'in record));assert.deepEqual(fake.docs.get(`bookings/${stay.id}`),stay);
});
test('failed or lost completion commit preserves order and photo, and retry keeps the original completed record',async()=>{
  seed();const photo=await uploadHousekeepingPhoto(input,actor,now),body={bookingId:stay.id,startDate:stay.startDate,checkoutDate:stay.endDate,photoId:photo.id,cleaned:true};
  fake.failCommit=true;await assert.rejects(completeHousekeeping(body,actor,now));assert.equal(count('housekeepingReports'),0);assert.equal(count('housekeepingPhotos'),1);assert.deepEqual(fake.docs.get(`bookings/${stay.id}`),stay);
  fake.failCommit=false;fake.dropCommitResponse=true;await assert.rejects(completeHousekeeping(body,actor,now),/REPLY_LOST/);
  const result=await completeHousekeeping(body,actor,new Date(now.getTime()+60000));assert.equal(result.duplicate,true);assert.equal(result.completedAt,now.toISOString());assert.equal(count('housekeepingReports'),1);
});
test('foreign order/owner photo, unchecked cleaning, cancelled/unconfirmed and future stays cannot complete',async()=>{
  seed();const photo=await uploadHousekeepingPhoto(input,actor,now);const body={bookingId:stay.id,startDate:stay.startDate,checkoutDate:stay.endDate,photoId:photo.id,cleaned:true};
  await assert.rejects(completeHousekeeping({...body,cleaned:false},actor,now),/CONFIRMATION_REQUIRED/);
  await assert.rejects(completeHousekeeping(body,{...actor,uid:'OTHER'},now),/PHOTO_REQUIRED/);
  fake.set('bookings/OTHER',{...stay,id:'OTHER'});await assert.rejects(completeHousekeeping({...body,bookingId:'OTHER'},actor,now),/PHOTO_REQUIRED/);
  for(const status of ['pending','cancelled']){fake.set(`bookings/${stay.id}`,{...stay,status});await assert.rejects(completeHousekeeping(body,actor,now),/NOT_CONFIRMED/);}
  fake.set(`bookings/${stay.id}`,{...stay,endDate:'2026-10-11'});await assert.rejects(uploadHousekeepingPhoto({...input,checkoutDate:'2026-10-11'},actor,now),/NOT_DUE/);assert.equal(count('housekeepingReports'),0);
});
test('date edits invalidate staged photos; malformed and oversized photos are rejected before writes',async()=>{
  seed();const photo=await uploadHousekeepingPhoto(input,actor,now);fake.set(`bookings/${stay.id}`,{...stay,endDate:'2026-10-09'});
  await assert.rejects(completeHousekeeping({bookingId:stay.id,startDate:stay.startDate,checkoutDate:stay.endDate,photoId:photo.id,cleaned:true},actor,now),/DATE_CHANGED/);
  await assert.rejects(uploadHousekeepingPhoto({...input,photoBase64:Buffer.alloc(MAX_PHOTO_BYTES+1).toString('base64')},actor,now),/INVALID_PHOTO/);
  await assert.rejects(uploadHousekeepingPhoto({...input,photoBase64:Buffer.from('<svg>fake</svg>').toString('base64')},actor,now),/INVALID_PHOTO/);assert.equal(count('housekeepingReports'),0);
});
test('changing arrival date cannot reuse an earlier stay photo or completed report',async()=>{
  seed();const photo=await uploadHousekeepingPhoto(input,actor,now);
  const body={bookingId:stay.id,startDate:stay.startDate,checkoutDate:stay.endDate,photoId:photo.id,cleaned:true};
  await completeHousekeeping(body,actor,now);
  fake.set(`bookings/${stay.id}`,{...stay,startDate:'2026-10-08'});
  await assert.rejects(completeHousekeeping(body,actor,now),/DATE_CHANGED/);
  await assert.rejects(completeHousekeeping({...body,startDate:'2026-10-08'},actor,now),/PHOTO_REQUIRED/);
  const replacement=await uploadHousekeepingPhoto({...input,startDate:'2026-10-08'},actor,now);
  assert.notEqual(replacement.id,photo.id);
  const revised=await completeHousekeeping({...body,startDate:'2026-10-08',photoId:replacement.id},actor,now);
  assert.equal(revised.duplicate,false);assert.equal(count('housekeepingReports'),2);
});
test('photo API never exposes bytes without existing staff/admin authorization',async()=>{
  seed();const photo=await uploadHousekeepingPhoto(input,actor,now);fake.calls.length=0;
  const denied=await invoke(photoHandler,null,{method:'GET',query:{id:photo.id}});assert.equal(denied.status,401);assert.equal(fake.calls.length,0);
  fake.authUser={localId:'stranger',email:'stranger@example.invalid'};const foreign=await invoke(photoHandler,null,{method:'GET',query:{id:photo.id},headers:{authorization:'Bearer FAKE'}});assert.equal(foreign.status,403);
  fake.authUser={localId:actor.uid,email:actor.email};const allowed=await invoke(photoHandler,null,{method:'GET',query:{id:photo.id},headers:{authorization:'Bearer FAKE'}});assert.equal(allowed.status,200);assert.ok(Buffer.isBuffer(allowed.data));assert.match(allowed.headers['Cache-Control'],/no-store/);assert.equal(allowed.headers['Content-Type'],'image/jpeg');
});
test('calendar follows all pages, includes checkout on month first day, and returns metadata without photo bytes',async()=>{
  fake.pageSize=2;for(let i=0;i<6;i++)fake.set(`bookings/B${i}`,{...stay,id:`B${i}`,startDate:'2026-09-30',endDate:'2026-10-01'});
  fake.set('bookings/CANCELLED',{...stay,status:'cancelled'});fake.set('housekeepingReports/R',{bookingId:'B0',checkoutDate:'2026-10-01',status:'completed',photoId:'PHOTO',completedAt:now.toISOString()});
  const result=await invoke(calendarHandler,null,{method:'GET',query:{month:'2026-10'},headers:{authorization:'Bearer FAKE'}});assert.equal(result.status,200);assert.equal(result.data.bookings.length,6);assert.ok(!JSON.stringify(result.data).includes('base64'));
});
test('notification settings do not infer recipient from login and cannot activate without a scheduler',async()=>{
  assert.equal(reminderSettings().email,'');assert.equal(reminderSettings().enabled,false);assert.throws(()=>reminderSettings({email:'a@example.invalid\nBcc:x'}),/INVALID_REMINDER_EMAIL/);
  fake.authUser={localId:'synthetic-admin',email:'admin@example.invalid'};fake.set('admins/synthetic-admin',{});
  const result=await invoke(settingsHandler,{contactName:'合成房務',email:'synthetic@example.invalid',arrivalTime:'09:00',checkoutTime:'12:00',preArrivalMinutes:60},{headers:{authorization:'Bearer FAKE'}});assert.equal(result.status,200);assert.equal(result.data.settings.enabled,false);
  const activation=await invoke(settingsHandler,{...result.data.settings,activate:true},{headers:{authorization:'Bearer FAKE'}});assert.equal(activation.status,400);assert.equal(fake.docs.get(SETTINGS_PATH).enabled,false);
  assert.equal((await invoke(cronHandler,null,{method:'GET'})).status,503);
});
test('confirmed booking and its jobs commit together; rejected confirmation schedules nothing; retries never backfill',async()=>{
  const upcoming={...stay,id:'UPCOMING',status:'pending',startDate:'2026-11-01',endDate:'2026-11-03'};fake.set('bookings/UPCOMING',upcoming);fake.set(SETTINGS_PATH,activeSettings);fake.failCommit=true;
  await assert.rejects(setBookingStatus('UPCOMING','confirmed'));assert.equal(fake.docs.get('bookings/UPCOMING').status,'pending');assert.equal(count('housekeepingNotifications'),0);
  fake.failCommit=false;await setBookingStatus('UPCOMING','confirmed');assert.equal(count('housekeepingNotifications'),4);await setBookingStatus('UPCOMING','confirmed');assert.equal(count('housekeepingNotifications'),4);
  fake.reset();fake.set('bookings/UPCOMING',{...upcoming,status:'confirmed'});fake.set(SETTINGS_PATH,activeSettings);await setBookingStatus('UPCOMING','confirmed');assert.equal(count('housekeepingNotifications'),0);
});
test('unconfigured or disabled reminder worker never sends or scans history',async()=>{
  let calls=0;const result=await runHousekeepingReminders({now,mailerReady:true,deliver:async()=>calls++});assert.equal(result.enabled,false);assert.equal(calls,0);assert.ok(!fake.calls.some(x=>x.url.includes('housekeepingNotifications')));
});
test('Asia/Taipei jobs include work links and never include lock passwords or customer notes',()=>{
  const jobs=newConfirmationJobs(stay,activeSettings,now);const checkout=jobs.find(x=>x.kind==='checkout');assert.equal(checkout.dueAt,'2026-10-10T04:00:00.000Z');assert.ok(!jobs.some(x=>x.kind==='arrival'));
  const mail=housekeepingMail(checkout,{...stay,notes:'SECRET-CODE-9999'},activeSettings);assert.match(mail.text,/housekeeping\/\?date=/);assert.match(mail.text,/拍一張客廳/);assert.ok(!mail.text.includes('9999'));
  const arrival=housekeepingMail({...checkout,kind:'arrival'},stay,activeSettings);assert.match(arrival.text,/回傳官方 LINE/);
});
test('completed, cancelled and rescheduled jobs become stale without sending',async()=>{
  for(const scenario of ['completed','cancelled','rescheduled']){
    fake.reset();fake.set(SETTINGS_PATH,activeSettings);seed();const job=newConfirmationJobs(stay,activeSettings,now).find(x=>x.kind==='checkout');fake.set(`housekeepingNotifications/${job.id}`,job);
    if(scenario==='completed')fake.set(`housekeepingReports/${reportId(stay.id,stay.endDate,stay.startDate)}`,{status:'completed'});
    else fake.set(`bookings/${stay.id}`,{...stay,...(scenario==='cancelled'?{status:'cancelled'}:{endDate:'2026-10-11'})});
    let sent=0;await runHousekeepingReminders({now,mailerReady:true,deliver:async()=>sent++});assert.equal(sent,0);assert.equal(fake.docs.get(`housekeepingNotifications/${job.id}`).status,'stale');
  }
});
test('parallel notification runs send at most once; an ambiguous Gmail failure is never auto-retried',async()=>{
  seed();fake.set(SETTINGS_PATH,activeSettings);const job=newConfirmationJobs(stay,activeSettings,now).find(x=>x.kind==='checkout');fake.set(`housekeepingNotifications/${job.id}`,job);let sent=0;
  await Promise.all([1,2].map(()=>runHousekeepingReminders({now,mailerReady:true,deliver:async()=>{sent++;await new Promise(r=>setTimeout(r,1));}})));assert.equal(sent,1);
  fake.reset();seed();fake.set(SETTINGS_PATH,activeSettings);fake.set(`housekeepingNotifications/${job.id}`,job);let attempts=0;for(let i=0;i<2;i++)await runHousekeepingReminders({now,mailerReady:true,deliver:async()=>{attempts++;throw new Error('SYNTHETIC_NETWORK_RESULT_UNKNOWN');}});
  assert.equal(attempts,1);assert.equal(fake.docs.get(`housekeepingNotifications/${job.id}`).status,'delivery_uncertain');
});
