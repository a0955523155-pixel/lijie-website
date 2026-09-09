import crypto from 'node:crypto';
import { getBooking, putBooking } from './firestore-admin.js';
import { gmailReady, sendMail, adminNotificationEmail, cancellationRequestMail } from './gmail-mailer.js';

function safeEqual(a,b){try{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y)}catch{return false}}
function verifySession(token){
  if(!token)throw new Error('BOOKING_SESSION_REQUIRED');
  const [body,sig,extra]=String(token).split('.'); if(!body||!sig||extra)throw new Error('BOOKING_SESSION_INVALID');
  const secrets=[process.env.BOOKING_SESSION_SECRET,process.env.LINE_CHANNEL_SECRET].map(x=>String(x||'').trim()).filter(Boolean);
  if(!secrets.some(secret=>safeEqual(sig,crypto.createHmac('sha256',secret).update(body).digest('base64url'))))throw new Error('BOOKING_SESSION_INVALID');
  let p;try{p=JSON.parse(Buffer.from(body,'base64url').toString('utf8'))}catch{throw new Error('BOOKING_SESSION_INVALID')}
  if(!p?.uid||!p?.exp||Date.now()>Number(p.exp))throw new Error('BOOKING_SESSION_EXPIRED'); return p;
}
function clean(v,max=300){return String(v??'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,max)}
async function authorizedBooking(sessionToken,id){
  const s=verifySession(sessionToken); const b=await getBooking(id); if(!b)throw new Error('BOOKING_NOT_FOUND');
  if(b.lineUserId&&b.lineUserId!==s.uid)throw new Error('BOOKING_LINE_MISMATCH');
  if(String(b.status||'')==='cancelled')throw new Error('BOOKING_ALREADY_CANCELLED');
  return {s,b};
}

export default async function handler(req,res){
  try{
    if(req.method==='GET'){
      const session=clean(req.query?.session,4000),id=clean(req.query?.booking,100); const {b}=await authorizedBooking(session,id);
      return res.status(200).json({ok:true,booking:{id:b.id,startDate:b.startDate,endDate:b.endDate,people:b.people||0,guestName:b.guestName||'',totalAmount:Number(b.totalAmount??b.quotedTotal)||0,paidAmount:Number(b.paidAmount||b.amountReceived)||0,status:b.status||'pending',cancellationRequestStatus:b.cancellationRequestStatus||''}});
    }
    if(req.method==='POST'){
      const body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});
      const session=clean(body.session,4000),id=clean(body.bookingId,100),reason=clean(body.reason,500);
      if(!reason)throw new Error('REQUEST_REASON_REQUIRED');
      const {b}=await authorizedBooking(session,id); const now=new Date().toISOString();
      const updated={...b,cancellationRequestStatus:'pending',cancellationRequestedAt:now,cancellationRequestReason:reason,cancellationRequestedBy:'customer',updatedAt:now}; delete updated.id;
      await putBooking(id,updated);
      if(gmailReady()){
        if(b.email){try{const m=cancellationRequestMail({id,...updated},reason,{admin:false});await sendMail({to:b.email,subject:m.subject,text:m.text,html:m.html});}catch(e){console.warn('customer cancellation email failed',e)}}
        const adminTo=adminNotificationEmail(); if(adminTo){try{const m=cancellationRequestMail({id,...updated},reason,{admin:true});await sendMail({to:adminTo,subject:m.subject,text:m.text,html:m.html});}catch(e){console.warn('admin cancellation email failed',e)}}
      }
      return res.status(200).json({ok:true,id});
    }
    res.setHeader('Allow','GET, POST'); return res.status(405).json({ok:false,error:'Method Not Allowed'});
  }catch(e){
    const code=String(e?.message||e); const status=code.includes('SESSION')?401:code==='BOOKING_NOT_FOUND'?404:400;
    return res.status(status).json({ok:false,error:code});
  }
}
