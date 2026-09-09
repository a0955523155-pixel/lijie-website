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

async function pushLine(userId,messages){
  const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||'').trim();
  if(!token||!userId)return false;
  const list=Array.isArray(messages)?messages:[messages];
  const r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({to:userId,messages:list})});
  if(!r.ok){const txt=await r.text();throw new Error(`LINE_PUSH_${r.status}:${txt.slice(0,300)}`)}
  return true;
}

function cancellationSubmittedFlex(b,reason){
  return {type:'flex',altText:'俐姐的家｜取消預約申請已送出',contents:{type:'bubble',size:'mega',
    header:{type:'box',layout:'vertical',backgroundColor:'#173A35',paddingAll:'20px',contents:[
      {type:'text',text:"LIJIE'S HOME",color:'#D8C89F',size:'xs',weight:'bold'},
      {type:'text',text:'取消申請已收到 🌿',color:'#FFFFFF',size:'xl',weight:'bold',margin:'sm'},
      {type:'text',text:'謝謝您提前告訴我們，俐姐會盡快協助確認。',color:'#DCE7E3',size:'sm',wrap:true,margin:'sm'}]},
    body:{type:'box',layout:'vertical',paddingAll:'20px',spacing:'md',contents:[
      {type:'text',text:`${b.startDate||'—'} → ${b.endDate||'—'}`,size:'xl',weight:'bold',color:'#173A35',wrap:true},
      {type:'text',text:`訂單編號｜${b.id||'—'}\n取消原因｜${reason||'—'}`,size:'sm',wrap:true,color:'#44544F',lineSpacing:'5px'},
      {type:'separator',color:'#E8E1D6',margin:'sm'},
      {type:'text',text:'目前狀態｜等待俐姐回覆',size:'md',weight:'bold',color:'#2F6F62'},
      {type:'text',text:'目前僅為取消申請，訂單尚未正式取消，原住宿日期也尚未釋出。若已支付訂金，後續保留或退款方式會再與您確認。',size:'sm',wrap:true,color:'#65736E',lineSpacing:'5px'},
      {type:'text',text:'若處理過程造成您的不便，還請見諒。很可惜這次沒能與您見面，也期待下次有機會在後壁湖迎接您 💚',size:'sm',wrap:true,color:'#65736E',lineSpacing:'5px'}]},
    footer:{type:'box',layout:'vertical',paddingAll:'14px',contents:[
      {type:'button',style:'primary',color:'#2F6F62',height:'sm',action:{type:'message',label:'查詢我的訂單',text:'查詢訂單'}}
    ]}}};
}
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
      try{await pushLine(b.lineUserId||'',cancellationSubmittedFlex({id,...updated},reason));}catch(e){console.warn('customer cancellation LINE push failed',e)}
      return res.status(200).json({ok:true,id,lineNotified:Boolean(b.lineUserId)});
    }
    res.setHeader('Allow','GET, POST'); return res.status(405).json({ok:false,error:'Method Not Allowed'});
  }catch(e){
    const code=String(e?.message||e); const status=code.includes('SESSION')?401:code==='BOOKING_NOT_FOUND'?404:400;
    return res.status(status).json({ok:false,error:code});
  }
}
