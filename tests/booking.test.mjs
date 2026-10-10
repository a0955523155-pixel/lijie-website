import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { installFakeFirestore,session,invoke } from './firestore-fake.mjs';
const fake=installFakeFirestore();
const fs=await import('../api/firestore-admin.js');
const {default:submit,normalizeBooking}=await import('../api/line-booking-submit.js');
const {default:payment}=await import('../api/line-payment-report.js');
const {default:webhook,submitPaymentReport}=await import('../api/line-webhook.js');
const {default:confirm}=await import('../api/admin-booking-confirm.js');
const {default:cancelRequest}=await import('../api/line-cancel-request.js');
const {default:notify}=await import('../api/admin-customer-notify.js');
const booking=(extra={})=>({startDate:'2026-11-01',endDate:'2026-11-03',status:'pending',lineUserId:'U-A',paidAmount:3000,depositRequired:3000,...extra});
test.beforeEach(()=>{fake.reset();process.env.LINE_CHANNEL_ACCESS_TOKEN='';});
test('parallel confirmations: one winner, loser remains pending and all nights share one lock',async()=>{
  fake.set('bookings/A',booking());fake.set('bookings/B',booking());
  const result=await Promise.allSettled([fs.setBookingStatus('A','confirmed'),fs.setBookingStatus('B','confirmed')]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  const winner=fake.docs.get('availability/2026-11-01').bookingId;
  assert.equal(fake.docs.get('availability/2026-11-02').bookingId,winner);
  assert.equal(fake.docs.get(`bookings/${winner}`).status,'confirmed');
  assert.equal(fake.docs.get(`bookings/${winner==='A'?'B':'A'}`).status,'pending');
});
test('conflict and failed commit never change pending state or partially lock dates',async()=>{
  fake.set('bookings/A',booking());fake.set('availability/2026-11-02',{status:'blocked'});
  await assert.rejects(fs.setBookingStatus('A','confirmed'),/BOOKING_DATE_CONFLICT/);
  assert.equal(fake.docs.get('bookings/A').status,'pending');assert.equal(fake.docs.has('availability/2026-11-01'),false);
  fake.reset();fake.set('bookings/A',booking());fake.failCommit=true;
  await assert.rejects(fs.setBookingStatus('A','confirmed'),/FIRESTORE_TRANSACTION_FAILED/);
  assert.equal(fake.docs.get('bookings/A').status,'pending');assert.equal(fake.docs.has('availability/2026-11-01'),false);
});
test('ABORTED retries; repeated confirmation validates all date locks before alreadyConfirmed',async()=>{
  fake.set('bookings/A',booking());fake.abortOnce=true;
  await fs.setBookingStatus('A','confirmed');assert.ok(fake.calls.filter(x=>x.url.endsWith(':beginTransaction')).length>=2);
  assert.equal((await fs.setBookingStatus('A','confirmed')).alreadyConfirmed,true);
  fake.set('availability/2026-11-02',{status:'booked',bookingId:'OTHER'});
  await assert.rejects(fs.setBookingStatus('A','confirmed'),/BOOKING_DATE_CONFLICT/);
});
test('admin endpoint revalidates an old confirmed record rather than returning early',async()=>{
  fake.set('admins/synthetic-admin',{});fake.set('bookings/A',booking({status:'confirmed'}));
  fake.set('availability/2026-11-02',{status:'booked',bookingId:'OTHER'});
  const result=await invoke(confirm,{bookingId:'A'},{headers:{authorization:'Bearer fake'}});
  assert.equal(result.data.ok,false);assert.match(result.data.error,/BOOKING_DATE_CONFLICT/);
});
test('deposit and cancelled checks are inside the status transaction',async()=>{
  fake.set('bookings/A',booking({paidAmount:0}));await assert.rejects(fs.setBookingStatus('A','confirmed'),/DEPOSIT_NOT_PAID/);
  fake.set('bookings/A',booking({status:'cancelled'}));await assert.rejects(fs.setBookingStatus('A','confirmed'),/BOOKING_CANCELLED/);
});
test('pending requests recheck availability; inquiries do not lock dates or become confirmed',async()=>{
  await Promise.all([fs.createPendingBooking('A',booking({paidAmount:0})),fs.createPendingBooking('B',booking({paidAmount:0}))]);
  assert.equal(fake.docs.size,2);assert.equal(fake.docs.get('bookings/A').status,'pending');
  await fs.setBookingStatus('A','confirmed').catch(()=>{});
  fake.set('availability/2026-11-02',{status:'booked',bookingId:'OTHER'});
  await assert.rejects(fs.createPendingBooking('C',booking()),/BOOKING_DATE_CONFLICT/);
  assert.equal(fake.docs.has('bookings/C'),false);
});
test('submission vs confirmation is serialized; stale client cannot bypass newly booked dates',async()=>{
  fake.set('bookings/A',booking());
  await fs.setBookingStatus('A','confirmed');
  const result=await invoke(submit,{session:session('U-A'),booking:{checkIn:'2026-11-01',checkOut:'2026-11-03',name:'Synthetic',email:'test@example.invalid',people:1}});
  assert.equal(result.data.ok,false);assert.match(result.data.code,/BOOKING_DATE_CONFLICT/);
  assert.equal([...fake.docs.keys()].filter(x=>x.startsWith('bookings/')).length,1);
});
test('calendar read failure rejects submission and preserves database',async()=>{
  fake.failRead=true;
  await assert.rejects(fs.createPendingBooking('A',booking()),/FIRESTORE_TRANSACTION_FAILED/);assert.equal(fake.docs.size,0);
});
test('1 and 12 guests submit; 13, zero and fractional guests are rejected; retry creates one order',async()=>{
  for(const people of [1,12]){
    const requestId=crypto.randomUUID(),body={session:session('U-A'),requestId,booking:{checkIn:'2026-11-01',checkOut:'2026-11-03',name:'Synthetic',email:'test@example.invalid',people}};
    const results=await Promise.all([invoke(submit,body),invoke(submit,body)]);
    assert.ok(results.every(r=>r.status===200));assert.equal(results[0].data.bookingId,results[1].data.bookingId);
  }
  assert.equal([...fake.docs.keys()].filter(k=>k.startsWith('bookings/')).length,2);
  for(const people of [13,0,1.5,'12abc',''])assert.throws(()=>normalizeBooking({checkIn:'2026-11-01',checkOut:'2026-11-03',name:'Synthetic',email:'test@example.invalid',people}),/INVALID_PEOPLE/);
});
test('text and form reports share one revision, history, lock and exact ownership checks',async()=>{
  fake.set('bookings/BABC1234',booking({paidAmount:0}));
  const first=await submitPaymentReport({id:'BABC1234',payerName:'Synthetic',last5:'12345',amount:3000},'U-A','event-1');
  assert.equal(first.paymentReportStatus,'pending');assert.equal(first.paidAmount,0);
  const form={session:session('U-A'),bookingId:'BABC1234',payerName:'Synthetic',last5:'54321'};
  assert.equal((await invoke(payment,form)).data.isRevision,true);
  const saved=fake.docs.get('bookings/BABC1234');assert.equal(saved.paymentReportHistory[0].last5,'12345');assert.equal(saved.paymentReportRevisionCount,1);
  assert.equal((await submitPaymentReport({id:'BABC1234',payerName:'Synthetic',last5:'12345',amount:3000},'U-A','event-1')).duplicate,true);
  await assert.rejects(submitPaymentReport({id:'BABC1234',payerName:'Synthetic',last5:'99999',amount:3000},'U-A','event-2'),/REVISION_USED/);
  fake.set('bookings/BABC1234',{...saved,paymentReportStatus:'verified'});
  assert.match((await invoke(payment,form)).data.error,/LOCKED/);
  await assert.rejects(submitPaymentReport({id:'BABC1234',payerName:'Synthetic',last5:'99999',amount:3000},'U-A','event-3'),/LOCKED/);
  assert.equal((await invoke(payment,{}, {method:'GET',query:{session:session('U-B'),booking:'BABC1234'}})).data.error,'BOOKING_LINE_MISMATCH');
});
test('concurrent identical reports are idempotent; changed report cannot exceed one revision',async()=>{
  fake.set('bookings/A',booking({paidAmount:0}));const info={uid:'U-A',payerName:'Synthetic',last5:'12345',amount:3000,source:'test'};
  await Promise.all([fs.savePaymentReport('A',info),fs.savePaymentReport('A',info)]);
  assert.equal(fake.docs.get('bookings/A').paymentReportRevisionCount,0);
  await Promise.allSettled([fs.savePaymentReport('A',{...info,last5:'22222'}),fs.savePaymentReport('A',{...info,last5:'33333'})]);
  assert.equal(fake.docs.get('bookings/A').paymentReportRevisionCount,1);assert.equal(fake.docs.get('bookings/A').paymentReportHistory.length,1);
});
test('missing ownership, paid/cancelled locks, bad last5 and wrong amount cannot overwrite reports',async()=>{
  const info={uid:'U-A',payerName:'Synthetic',last5:'12345',amount:3000,source:'test'};
  for(const change of [{lineUserId:''},{paidAmount:3000},{amountReceived:3000,paidAmount:0},{status:'confirmed'},{status:'cancelled'}]){
    fake.set('bookings/A',booking({paidAmount:0,...change}));await assert.rejects(fs.savePaymentReport('A',info));
  }
  fake.set('bookings/A',booking({paidAmount:0}));
  await assert.rejects(fs.savePaymentReport('A',{...info,last5:'123456'}),/PAYMENT_LAST5_REQUIRED/);
  await assert.rejects(fs.savePaymentReport('A',{...info,amount:4000}),/PAYMENT_AMOUNT_MISMATCH/);
});
test('multiple orders require selection; query reads all before sorting and paginating without leaks',async()=>{
  for(let i=0;i<14;i++)fake.set(`bookings/B${i}`,booking({startDate:`2026-11-${String(i+1).padStart(2,'0')}`,createdAt:`2026-10-${String(i+1).padStart(2,'0')}`,paidAmount:0}));
  fake.set('bookings/FOREIGN',booking({lineUserId:'U-B'}));
  await assert.rejects(submitPaymentReport({payerName:'Synthetic',last5:'12345',amount:3000},'U-A','event'),/SELECTION_REQUIRED/);
  const ids=[];for(let page=1;page<=5;page++){const result=await fs.customerBookingsPage('U-A',{page});assert.equal(result.total,14);ids.push(...result.items.map(x=>x.id));}
  assert.equal(new Set(ids).size,14);assert.equal(ids.includes('FOREIGN'),false);assert.deepEqual(ids.slice(0,3),['B0','B1','B2']);
  assert.ok(fake.calls.filter(c=>c.url.endsWith(':runQuery')).every(c=>!c.body.structuredQuery.limit));
});
test('priority puts upcoming stays before old unfinished then completed, retaining legacy dates',()=>{
  const rows=[{id:'past',status:'confirmed',startDate:'2026-01-01'},{id:'pending',status:'pending',startDate:'2026-02-01'},{id:'next',status:'confirmed',startDate:'2026-11-01',endDate:'2026-11-02'},{id:'cancel',status:'cancelled',createdAt:'2026-10-01'}];
  assert.deepEqual(fs.sortCustomerBookings(rows,'2026-10-10').map(x=>x.id),['next','pending','cancel','past']);
});
test('signed duplicate webhook does not reapply or consume revision; page reply stays within LINE limit',async()=>{
  process.env.LINE_CHANNEL_ACCESS_TOKEN='SYNTHETIC';fake.set('bookings/BABC1234',booking({paidAmount:0}));
  async function call(text,eventId){
    const raw=JSON.stringify({events:[{type:'message',replyToken:'synthetic-reply',webhookEventId:eventId,source:{userId:'U-A'},message:{type:'text',id:eventId,text}}]});
    const req=Readable.from([Buffer.from(raw)]);req.method='POST';req.headers={'x-line-signature':crypto.createHmac('sha256',process.env.LINE_CHANNEL_SECRET).update(raw).digest('base64')};
    const res={status(){return this;},json(v){return v;}};await webhook(req,res);
  }
  const text='匯款回報 BABC1234 付款人 Synthetic 末五碼 12345 金額 3000';await call(text,'evt-1');await call(text,'evt-1');
  assert.equal(fake.docs.get('bookings/BABC1234').paymentReportRevisionCount,0);assert.equal(fake.replies.length,1);
  for(let i=0;i<8;i++)fake.set(`bookings/MORE${i}`,booking({paidAmount:0}));
  await call('查詢訂單 2','evt-2');assert.ok(fake.replies.at(-1).messages.length<=5);assert.match(fake.replies.at(-1).messages[0].text,/第 2\/3 頁/);
});
test('legacy submission retries also deduplicate; changed input with a reused key is rejected',async()=>{
  const body={session:session('U-A'),booking:{checkIn:'2026-11-01',checkOut:'2026-11-03',name:'Synthetic',email:'test@example.invalid',people:1}};
  const first=await invoke(submit,body),second=await invoke(submit,body);assert.equal(first.data.bookingId,second.data.bookingId);
  const key=crypto.randomUUID();assert.equal((await invoke(submit,{...body,requestId:key})).status,200);
  assert.equal((await invoke(submit,{...body,requestId:key,booking:{...body.booking,people:12}})).data.code,'REQUEST_ID_REUSED');
});
test('cancellation requests preserve confirmation/finance fields and enforce exact ownership',async()=>{
  fake.set('bookings/A',booking());
  await Promise.all([fs.setBookingStatus('A','confirmed'),fs.saveServiceRequest('A','U-A',{cancellationRequestStatus:'pending',cancellationRequestReason:'synthetic'})]);
  assert.equal(fake.docs.get('bookings/A').status,'confirmed');assert.equal(fake.docs.get('bookings/A').paidAmount,3000);
  assert.equal(fake.docs.get('bookings/A').cancellationRequestStatus,'pending');
  for(const uid of ['U-B',''])await assert.rejects(fs.saveServiceRequest('A',uid,{refundRequestStatus:'pending'}),/BOOKING_LINE_MISMATCH/);
  fake.set('bookings/UNBOUND',booking({lineUserId:''}));
  assert.equal((await invoke(cancelRequest,{}, {method:'GET',query:{session:session('U-A'),booking:'UNBOUND'}})).data.error,'BOOKING_LINE_MISMATCH');
});
test('form rejects six last-five digits instead of silently truncating',async()=>{
  fake.set('bookings/A',booking({paidAmount:0}));
  const result=await invoke(payment,{session:session('U-A'),bookingId:'A',payerName:'Synthetic',last5:'123456'});
  assert.equal(result.data.error,'PAYMENT_LAST5_REQUIRED');assert.equal(fake.docs.get('bookings/A').paymentReportStatus,undefined);
});
test('notification recording cannot overwrite a confirmation or resurrect a concurrent cancellation',async()=>{
  for(const status of ['confirmed','cancelled']){
    fake.reset();fake.set('admins/synthetic-admin',{});fake.set('bookings/A',booking());
    process.env.LINE_CHANNEL_ACCESS_TOKEN='SYNTHETIC';
    fake.onLinePush=()=>fs.setBookingStatus('A',status);
    const result=await invoke(notify,{bookingId:'A',event:'refund_completed',notificationId:`synthetic-${status}`},{headers:{authorization:'Bearer fake'}});
    assert.equal(result.data.ok,true);assert.equal(fake.docs.get('bookings/A').status,status);
    assert.equal(fake.docs.get('bookings/A').lastCustomerNotificationId,`synthetic-${status}`);
    assert.equal(fake.docs.has('availability/2026-11-01'),status==='confirmed');
  }
});
