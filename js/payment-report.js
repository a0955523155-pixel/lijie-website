const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search);
const session=params.get('session')||'';
const bookingId=params.get('booking')||'';
const money=n=>`NT$ ${Number(n||0).toLocaleString('zh-TW')}`;
let booking=null;

function setFormVisible(show){$('#paymentReportForm').classList.toggle('hidden',!show)}
function showSuccess(text,canRevise=false){
  $('#paymentResult').textContent='';
  $('#paymentSuccess').classList.remove('hidden');
  $('#paymentSuccessText').innerHTML=text;
  $('#paymentRevise').classList.toggle('hidden',!canRevise);
}
function applyReportState(){
  if(!booking)return;
  if(booking.paymentReportHasReport){
    setFormVisible(false);
    if(booking.paymentReportLocked) showSuccess('這筆匯款回報已完成核帳，資料已鎖定。💚',false);
    else if(booking.paymentReportCanRevise) showSuccess('已收到你的匯款回報 💚<br>如果剛剛資料填錯，可再修改 1 次。',true);
    else showSuccess('已收到你的匯款回報 💚<br>修正次數已使用，如仍需更改請聯絡官方 LINE。',false);
  }else{
    $('#paymentSuccess').classList.add('hidden');
    setFormVisible(true);
  }
}

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
    applyReportState();
  }catch(e){ $('#paymentLoading').textContent=`目前無法開啟匯款回報：${e.message||e}`; }
}

$('#paymentRevise').addEventListener('click',()=>{
  if(!booking?.paymentReportCanRevise)return;
  $('#paymentSuccess').classList.add('hidden');
  setFormVisible(true);
  $('#paymentSubmit').textContent='送出修正資料';
  $('#paymentResult').textContent='你有 1 次修正機會，送出後將不能再次自行修改。';
  $('#payerName').focus();
});

$('#paymentReportForm').addEventListener('submit',async e=>{
  e.preventDefault(); const payerName=$('#payerName').value.trim(),last5=$('#payerLast5').value.trim();
  if(!payerName)return $('#paymentResult').textContent='請填寫付款人姓名。';
  if(!/^\d{5}$/.test(last5))return $('#paymentResult').textContent='末五碼請輸入 5 位數字。';
  const btn=$('#paymentSubmit'); btn.disabled=true; $('#paymentResult').textContent='正在送出回報…';
  try{
    const r=await fetch('/api/line-payment-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,bookingId,payerName,last5})});
    const j=await r.json(); if(!r.ok) throw new Error(j.error||'送出失敗');
    booking.paymentReportHasReport=true;
    booking.paymentReportPayerName=payerName;
    booking.paymentReportLast5=last5;
    booking.paymentReportRevisionCount=Number(j.revisionCount)||0;
    booking.paymentReportCanRevise=Boolean(j.canRevise);
    setFormVisible(false);
    showSuccess(j.isRevision?'修正資料已送出 💚<br>這次修正已使用，如仍需更改請聯絡官方 LINE。':'已收到你的匯款回報 💚<br>如果剛剛資料填錯，可再修改 1 次。',Boolean(j.canRevise));
  }catch(err){
    const code=String(err.message||err);
    const text=code==='PAYMENT_REPORT_LOCKED'?'這筆訂金已完成核帳，不能再修改。':code==='PAYMENT_REPORT_REVISION_USED'?'這筆回報已使用過修正機會，如需再改請聯絡官方 LINE。':`送出失敗：${code}`;
    $('#paymentResult').textContent=text; btn.disabled=false;
  }
});

load();
