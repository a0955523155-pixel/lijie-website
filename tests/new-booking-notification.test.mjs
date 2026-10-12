import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {installFakeFirestore,invoke,session} from './firestore-fake.mjs';
const fake=installFakeFirestore();
const {adminNotificationEmail,newBookingNotificationRecipients}=await import('../api/gmail-mailer.js');
const submit=(await import('../api/line-booking-submit.js')).default;
const payment=(await import('../api/line-payment-report.js')).default;
const cancellation=(await import('../api/line-cancel-request.js')).default;
const webhook=(await import('../api/line-webhook.js')).default;
const confirmation=(await import('../api/admin-booking-confirm.js')).default;
const notify=(await import('../api/admin-customer-notify.js')).default;
const original='original@example.invalid',extra='second@example.invalid',guest='guest@example.invalid';
const address=message=>message.match(/^To: (.*)$/m)?.[1].trim();
const recipients=()=>fake.gmailMessages.map(address);
function input(){return {session:session('U-SYNTHETIC'),requestId:crypto.randomUUID(),booking:{checkIn:'2026-11-01',checkOut:'2026-11-03',name:'合成旅客',phone:'0900000000',email:guest,people:12,notes:'PRIVATE_SYNTHETIC_NOTE',purpose:'PRIVATE_SYNTHETIC_PURPOSE'}};}
function seed(){fake.set('bookings/BABC1234',{startDate:'2026-11-01',endDate:'2026-11-03',guestName:'合成旅客',email:guest,phone:'0900000000',people:12,status:'pending',lineUserId:'U-SYNTHETIC',paidAmount:0,depositRequired:3000,totalAmount:12000});}
test.beforeEach(()=>{
 fake.reset();process.env.GMAIL_CLIENT_ID='SYNTHETIC_CLIENT';process.env.GMAIL_CLIENT_SECRET='SYNTHETIC_SECRET';process.env.GMAIL_REFRESH_TOKEN='SYNTHETIC_REFRESH';process.env.GMAIL_SENDER_EMAIL=original;process.env.GMAIL_SENDER_NAME='合成測試寄件者';process.env.ADMIN_NOTIFICATION_EMAIL='';process.env.NEW_BOOKING_NOTIFICATION_EXTRA_EMAIL=extra;process.env.LINE_CHANNEL_ACCESS_TOKEN='';
});
test('new-booking recipients preserve the original fallback and explicit admin route; no extra keeps exact original behavior',()=>{
 assert.equal(adminNotificationEmail(),original);assert.deepEqual(newBookingNotificationRecipients(),[original,extra]);
 process.env.ADMIN_NOTIFICATION_EMAIL='explicit@example.invalid';assert.deepEqual(newBookingNotificationRecipients(),['explicit@example.invalid',extra]);assert.equal(adminNotificationEmail(),'explicit@example.invalid');
 process.env.NEW_BOOKING_NOTIFICATION_EXTRA_EMAIL='';assert.deepEqual(newBookingNotificationRecipients(),['explicit@example.invalid']);
});
test('extra accepts one bare address, rejects invalid or injected values without losing original, and deduplicates case and existing lists',()=>{
 for(const value of ['not-an-email','one@example.invalid,two@example.invalid','one@example.invalid;two@example.invalid','one@example.invalid\r\nBcc:bad@example.invalid','one@example.invalid\n','.bad@example.invalid','bad..local@example.invalid','bad.@example.invalid','one@-bad.example','one@example..invalid',`${'a'.repeat(65)}@example.invalid`]){process.env.NEW_BOOKING_NOTIFICATION_EXTRA_EMAIL=value;assert.deepEqual(newBookingNotificationRecipients(),[original]);}
 process.env.NEW_BOOKING_NOTIFICATION_EXTRA_EMAIL=` ${original.toUpperCase()} `;assert.deepEqual(newBookingNotificationRecipients(),[original]);
 process.env.ADMIN_NOTIFICATION_EMAIL=`${original}, Team <${extra}>`;process.env.NEW_BOOKING_NOTIFICATION_EXTRA_EMAIL=extra.toUpperCase();assert.deepEqual(newBookingNotificationRecipients(),[`${original}, Team <${extra}>`]);
 process.env.ADMIN_NOTIFICATION_EMAIL=original;process.env.NEW_BOOKING_NOTIFICATION_EXTRA_EMAIL=` ${extra} `;assert.deepEqual(newBookingNotificationRecipients(),[original,extra]);
});
test('new request sends separately to guest, original and second, with only approved order fields and no auth/data writes beyond the pending booking',async()=>{
 const result=await invoke(submit,input());assert.equal(result.status,200);assert.deepEqual(recipients(),[guest,original,extra]);
 const adminMail=fake.gmailMessages[2];assert.match(adminMail,/Content-Type: multipart\/alternative/);
 const parts=[...adminMail.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)(?=\r?\n--)/g)].map(m=>Buffer.from(m[1].replace(/\s/g,''),'base64').toString('utf8'));const text=parts.join('\n');
 for(const value of ['合成旅客','0900000000',guest,'2026-11-01','2026-11-03','12 人','3,000',result.data.bookingId,'待收訂金'])assert.ok(text.includes(value),value);
 assert.ok(!text.includes('PRIVATE_SYNTHETIC_NOTE'));assert.ok(!text.includes('PRIVATE_SYNTHETIC_PURPOSE'));assert.ok(!text.includes('housekeeping/'));assert.equal(address(adminMail),extra);
 assert.deepEqual([...fake.docs.keys()],[`bookings/${result.data.bookingId}`]);assert.equal(fake.docs.get(`bookings/${result.data.bookingId}`).status,'pending');
});
test('a failed original or second send cannot block the other recipient or saving the order',async()=>{
 for(const failing of [original,extra,guest]){
  fake.reset();fake.onGmailSend=async message=>new Response(JSON.stringify(address(message)===failing?{error:'SYNTHETIC_MAIL_FAILURE'}:{id:'SYNTHETIC_OK'}),{status:address(message)===failing?503:200});
  const result=await invoke(submit,input());assert.equal(result.status,200);assert.deepEqual(recipients(),[guest,original,extra]);assert.equal(fake.docs.size,1);
 }
});
test('concurrent and repeated submissions send one set of emails; a changed retry does not resend',async()=>{
 const body=input();const results=await Promise.all([invoke(submit,body),invoke(submit,body)]);assert.ok(results.every(r=>r.status===200));assert.equal(fake.docs.size,1);assert.deepEqual(recipients(),[guest,original,extra]);
 assert.equal((await invoke(submit,body)).data.duplicate,true);assert.deepEqual(recipients(),[guest,original,extra]);
 assert.equal((await invoke(submit,{...body,booking:{...body.booking,people:1}})).data.code,'REQUEST_ID_REUSED');assert.deepEqual(recipients(),[guest,original,extra]);
});
test('payment form, cancellation form and refund webhook still notify original only; confirmation and completion only notify the guest',async()=>{
 seed();assert.equal((await invoke(payment,{session:session('U-SYNTHETIC'),bookingId:'BABC1234',payerName:'合成付款人',last5:'12345'})).status,200);assert.deepEqual(recipients(),[original]);
 fake.gmailMessages.length=0;assert.equal((await invoke(cancellation,{session:session('U-SYNTHETIC'),bookingId:'BABC1234',reason:'合成取消原因'})).status,200);assert.deepEqual(recipients(),[guest,original]);
 fake.gmailMessages.length=0;process.env.LINE_CHANNEL_ACCESS_TOKEN='SYNTHETIC_LINE_TOKEN';const body={events:[{type:'message',webhookEventId:'SYNTHETIC-REFUND-EVENT',replyToken:'SYNTHETIC-REPLY',source:{userId:'U-SYNTHETIC'},message:{type:'text',text:'退款 BABC1234 合成申請原因'}}]};const signature=crypto.createHmac('sha256',process.env.LINE_CHANNEL_SECRET).update(JSON.stringify(body)).digest('base64');const refund=await invoke(webhook,body,{headers:{'x-line-signature':signature}});assert.equal(refund.status,200);assert.deepEqual(recipients(),[guest,original]);
 fake.gmailMessages.length=0;process.env.LINE_CHANNEL_ACCESS_TOKEN='';fake.set('admins/synthetic-admin',{});fake.set('bookings/BABC1234',{...fake.docs.get('bookings/BABC1234'),paidAmount:3000});assert.equal((await invoke(confirmation,{bookingId:'BABC1234'},{headers:{authorization:'Bearer FAKE'}})).status,200);assert.deepEqual(recipients(),[guest]);assert.equal([...fake.docs.keys()].filter(p=>p.startsWith('housekeepingNotifications/')).length,0);
 fake.gmailMessages.length=0;assert.equal((await invoke(notify,{bookingId:'BABC1234',event:'refund_completed',notificationId:'SYNTHETIC-NOTIFY-001'},{headers:{authorization:'Bearer FAKE'}})).status,200);assert.deepEqual(recipients(),[guest]);
});
