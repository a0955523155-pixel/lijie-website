import crypto from 'node:crypto';
import { getBooking, putBooking } from './firestore-admin.js';
import { gmailReady, sendMail, adminNotificationEmail, paymentReportAdminMail } from './gmail-mailer.js';

function safeEqual(a,b){try{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y)}catch{return false}}
function verifySession(token){
  if(!token)throw new Error('BOOKING_SESSION_REQUIRED');
  const [body,sig,extra]=String(token).split('.'); if(!body||!sig||extra)throw new Error('BOOKING_SESSION_INVALID');
  const secrets=[process.env.BOOKING_SESSION_SECRET,process.env.LINE_CHANNEL_SECRET].map(x=>String(x||'').trim()).filter(Boolean);
  if(!secrets.some(secret=>safeEqual(sig,crypto.createHmac('sha256',secret).update(body).digest('base64url'))))throw new Error('BOOKING_SESSION_INVALID');
  let p;try{p=JSON.parse(Buffer.from(body,'base64url').toString('utf8'))}catch{throw new Error('BOOKING_SESSION_INVALID')}
  if(!p?.uid||!p?.exp||Date.now()>Number(p.exp))throw new Error('BOOKING_SESSION_EXPIRED'); return p;
}
function clean(v,max=80){return String(v??'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,max)}
async function authorizedBooking(sessionToken,id){const s=verifySession(sessionToken);const b=await getBooking(id);if(!b)throw new Error('BOOKING_NOT_FOUND');if(b.lineUserId&&b.lineUserId!==s.uid)throw new Error('BOOKING_LINE_MISMATCH');return {s,b}}

export default async function handler(req,res){
  try{
    if(req.method==='GET'){
      const session=clean(req.query?.session,4000),id=clean(req.query?.booking,100);const {b}=await authorizedBooking(session,id);
      return res.status(200).json({ok:true,booking:{id:b.id,startDate:b.startDate,endDate:b.endDate,totalAmount:Number(b.totalAmount??b.quotedTotal)||0,quotedTotal:Number(b.quotedTotal)||0,depositRequired:Number(b.depositRequired)||3000,paymentReportPayerName:b.paymentReportPayerName||'',paymentReportLast5:b.paymentReportLast5||'',paymentReportStatus:b.paymentReportStatus||''}});
    }
    if(req.method==='POST'){
      const body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});const session=clean(body.session,4000),id=clean(body.bookingId,100),payerName=clean(body.payerName,40),last5=clean(body.last5,5);
      if(!payerName)throw new Error('PAYER_NAME_REQUIRED');if(!/^\d{5}$/.test(last5))throw new Error('PAYMENT_LAST5_REQUIRED');
      const {b}=await authorizedBooking(session,id);const amount=Number(b.depositRequired)||3000,now=new Date().toISOString();
      const updated={...b,paymentReportStatus:'pending',paymentReportPayerName:payerName,paymentReportLast5:last5,paymentReportAmount:amount,paymentReportedAt:now,paymentReportSource:'official-line-form',updatedAt:now};delete updated.id;await putBooking(id,updated);
      if(gmailReady()){const to=adminNotificationEmail();if(to){try{const m=paymentReportAdminMail({id,...updated});await sendMail({to,subject:m.subject,text:m.text,html:m.html})}catch(e){console.warn('payment report admin email failed',e)}}}
      return res.status(200).json({ok:true,id,amount});
    }
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'Method Not Allowed'});
  }catch(e){const code=String(e?.message||e);const status=code.includes('SESSION')?401:code==='BOOKING_NOT_FOUND'?404:400;return res.status(status).json({ok:false,error:code});}
}
