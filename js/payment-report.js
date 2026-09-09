const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search);
const session=params.get('session')||'';
const bookingId=params.get('booking')||'';
const money=n=>`NT$ ${Number(n||0).toLocaleString('zh-TW')}`;
let booking=null;

async function load(){
  try{
    const r=await fetch(`/api/line-payment-report?session=${encodeURIComponent(session)}&booking=${encodeURIComponent(bookingId)}`,{cache:'no-store'});
    const j=await r.json(); if(!r.ok) throw new Error(j.error||'無法讀取訂單');
    booking=j.booking;
    $('#payBookingId').textContent=booking.id;
    $('#payStayDate').textContent=`${booking.startDate} → ${booking.endDate}`;
    $('#payTotal').textContent=money(booking.totalAmount||booking.quotedTotal);
    $('#payDeposit').textContent=money(booking.depositRequired||3000);
    if(booking.paymentReportPayerName) $('#payerName').value=booking.paymentReportPayerName;
    if(booking.paymentReportLast5) $('#payerLast5').value=booking.paymentReportLast5;
    $('#paymentLoading').classList.add('hidden'); $('#paymentContent').classList.remove('hidden');
  }catch(e){ $('#paymentLoading').textContent=`目前無法開啟匯款回報：${e.message||e}`; }
}

$('#paymentReportForm').addEventListener('submit',async e=>{
  e.preventDefault(); const payerName=$('#payerName').value.trim(),last5=$('#payerLast5').value.trim();
  if(!payerName)return $('#paymentResult').textContent='請填寫付款人姓名。';
  if(!/^\d{5}$/.test(last5))return $('#paymentResult').textContent='末五碼請輸入 5 位數字。';
  const btn=$('#paymentSubmit'); btn.disabled=true; $('#paymentResult').textContent='正在送出回報…';
  try{
    const r=await fetch('/api/line-payment-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,bookingId,payerName,last5})});
    const j=await r.json(); if(!r.ok) throw new Error(j.error||'送出失敗');
    $('#paymentReportForm').classList.add('hidden'); $('#paymentResult').textContent=''; $('#paymentSuccess').classList.remove('hidden');
  }catch(err){ $('#paymentResult').textContent=`送出失敗：${err.message||err}`; btn.disabled=false; }
});

load();
