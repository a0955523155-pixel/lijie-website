import { createAvailabilityCache } from "./availability-state.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, query, where, documentId, getDocsFromServer } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./config.js";

const grid=document.querySelector("#publicCalendar");
if(grid){
  const monthLabel=document.querySelector("#calendarMonth");
  const statusNode=document.querySelector("#calendarStatus");
  const prevBtn=document.querySelector("#calendarPrev");
  const nextBtn=document.querySelector("#calendarNext");
  const today=new Date(); today.setHours(0,0,0,0);
  let cursor=new Date(today.getFullYear(),today.getMonth(),1);
  let db=null;
  let renderVersion=0;
  const retry=document.createElement("button");retry.type="button";retry.textContent="重試日期狀況";retry.hidden=true;statusNode.after(retry);
  retry.addEventListener("click",()=>{availability.clear();render();});
  const maxMonths=6;
  if(isConfigured()){
    const app=getApps().length?getApps()[0]:initializeApp(firebaseConfig);
    db=getFirestore(app);
  }
  const keyOf=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  const monthFmt=new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"long"});
  const maxDate=()=>{const d=new Date(today);d.setMonth(d.getMonth()+maxMonths);return d;};
  const availability=createAvailabilityCache(async mk=>{
    if(!db)throw new Error("AVAILABILITY_NOT_CONFIGURED");
    const [y,m]=mk.split("-").map(Number),first=new Date(y,m-1,1),last=new Date(y,m,0);
    const q=query(collection(db,"availability"),where(documentId(),">=",keyOf(first)),where(documentId(),"<=",keyOf(last)));
    const snap=await getDocsFromServer(q);
    return new Map(snap.docs.map(d=>[d.id,d.data().status||"unknown"]));
  });
  function label(state){return state==="booked"?"已預約":state==="blocked"?"暫停":state==="unknown"?"無法確認":"可詢問";}
  async function render(){
    const version=++renderVersion;
    const first=new Date(cursor.getFullYear(),cursor.getMonth(),1),last=new Date(cursor.getFullYear(),cursor.getMonth()+1,0);
    monthLabel.textContent=monthFmt.format(first);
    grid.replaceChildren();
    for(let i=0;i<first.getDay();i++){const e=document.createElement("span");e.className="calendar-empty";grid.append(e);}
    availability.clear(); // Refresh on every navigation and retry; never use offline cache.
    retry.hidden=true;statusNode.textContent="正在確認日期…";
    try{await availability.load(monthKey(first));if(version!==renderVersion)return;statusNode.textContent="可詢問日期僅供參考；核帳及民宿確認後才成立訂房。";}
    catch(e){if(version!==renderVersion)return;console.warn("availability load failed",e);retry.hidden=false;statusNode.textContent="日期狀況無法確認，請重試或到官方 LINE 詢問。";}
    for(let day=1;day<=last.getDate();day++){
      const d=new Date(cursor.getFullYear(),cursor.getMonth(),day),past=d<today,beyond=d>maxDate();
      const state=past||beyond?"blocked":availability.state(keyOf(d));
      const b=document.createElement("button");b.type="button";b.className=`calendar-day ${state}`;b.disabled=true;b.setAttribute("aria-label",`${keyOf(d)} ${label(state)}`);
      b.innerHTML=`<span>${day}</span><small>${past?"已過":beyond?"尚未開放":label(state)}</small>`;grid.append(b);
    }
    prevBtn.disabled=cursor.getFullYear()===today.getFullYear()&&cursor.getMonth()===today.getMonth();
    const nm=new Date(cursor.getFullYear(),cursor.getMonth()+1,1),max=maxDate();nextBtn.disabled=nm>new Date(max.getFullYear(),max.getMonth(),1);
  }
  prevBtn?.addEventListener("click",()=>{if(prevBtn.disabled)return;cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render();});
  nextBtn?.addEventListener("click",()=>{if(nextBtn.disabled)return;cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render();});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)render();});
  setInterval(()=>{if(!document.hidden)render();},30_000);
  render();
}
