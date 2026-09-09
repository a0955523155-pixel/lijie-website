const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search); const session=params.get('session')||''; const bookingId=params.get('booking')||''; const money=n=>`NT$ ${Number(n||0).toLocaleString('zh-TW')}`;
async function load(){
  try{
    const r=await fetch(`/api/line-cancel-request?session=${encodeURIComponent(session)}&booking=${encodeURIComponent(bookingId)}`,{cache:'no-store'}); const j=await r.json(); if(!r.ok)throw new Error(j.error||'無法讀取訂單'); const b=j.booking;
    $('#cancelBookingId').textContent=b.id; $('#cancelStayDate').textContent=`${b.startDate} → ${b.endDate}`; $('#cancelGuests').textContent=`${b.people||0} 人`; $('#cancelTotal').textContent=money(b.totalAmount);
    $('#cancelLoading').classList.add('hidden'); $('#cancelContent').classList.remove('hidden');
    if(b.cancellationRequestStatus==='pending'){$('#cancelRequestForm').classList.add('hidden');$('#cancelSuccess').classList.remove('hidden');}
  }catch(e){$('#cancelLoading').textContent=`目前無法開啟取消申請：${e.message||e}`;}
}
$('#cancelRequestForm').addEventListener('submit',async e=>{
  e.preventDefault(); const reason=$('#cancelReason').value.trim(); if(!reason)return $('#cancelResult').textContent='請告訴我們這次取消的原因。';
  const btn=$('#cancelSubmit'); btn.disabled=true; $('#cancelResult').textContent='正在送出申請…';
  try{const r=await fetch('/api/line-cancel-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,bookingId,reason})}); const j=await r.json(); if(!r.ok)throw new Error(j.error||'送出失敗'); $('#cancelRequestForm').classList.add('hidden');$('#cancelResult').textContent='';$('#cancelSuccess').classList.remove('hidden');}
  catch(err){$('#cancelResult').textContent=`送出失敗：${err.message||err}`;btn.disabled=false;}
});
load();
