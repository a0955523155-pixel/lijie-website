export function reportState(b){
  const revisionCount=Math.max(0,Number(b.paymentReportRevisionCount)||0);
  const hasReport=Boolean(b.paymentReportStatus||b.paymentReportPayerName||b.paymentReportLast5);
  const locked=b.status==='cancelled'||b.status==='confirmed'||Math.max(Number(b.paidAmount)||0,Number(b.amountReceived)||0)>=(Number(b.depositRequired)||3000)||['verified','confirmed','paid','locked'].includes(String(b.paymentReportStatus||''));
  return {revisionCount,hasReport,locked,canRevise:hasReport&&!locked&&revisionCount<1};
}

export function paymentReportPatch(b,{uid,payerName,last5,amount,source,eventId},now){
  if(!uid || b.lineUserId!==uid) throw new Error('BOOKING_LINE_MISMATCH');
  if(eventId && (b.paymentReportEventIds||[]).includes(eventId)) return null;
  if(reportState(b).locked) throw new Error('PAYMENT_REPORT_LOCKED');
  payerName=String(payerName||'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,40); last5=String(last5||'').trim();
  if(!payerName) throw new Error('PAYER_NAME_REQUIRED');
  if(!/^\d{5}$/.test(last5)) throw new Error('PAYMENT_LAST5_REQUIRED');
  const deposit=Number(b.depositRequired)||3000;
  if(Number(amount)!==deposit) throw new Error('PAYMENT_AMOUNT_MISMATCH');
  const state=reportState(b);
  const identical=state.hasReport&&b.paymentReportPayerName===payerName&&b.paymentReportLast5===last5&&Number(b.paymentReportAmount)===deposit;
  const ids=[...(b.paymentReportEventIds||[]),...(eventId?[eventId]:[])];
  if(identical) return eventId?{paymentReportEventIds:ids}:null;
  if(state.hasReport&&state.revisionCount>=1) throw new Error('PAYMENT_REPORT_REVISION_USED');
  const history=[...(Array.isArray(b.paymentReportHistory)?b.paymentReportHistory:[])];
  if(state.hasReport) history.push({payerName:b.paymentReportPayerName||'',last5:b.paymentReportLast5||'',amount:Number(b.paymentReportAmount)||deposit,reportedAt:b.paymentReportedAt||'',source:b.paymentReportSource||'',replacedAt:now});
  return {paymentReportStatus:'pending',paymentReportPayerName:payerName,paymentReportLast5:last5,paymentReportAmount:deposit,paymentReportedAt:now,paymentReportSource:source,paymentReportRevisionCount:state.hasReport?state.revisionCount+1:state.revisionCount,paymentReportHistory:history,paymentReportEventIds:ids,updatedAt:now};
}
