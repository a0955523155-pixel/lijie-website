import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, query, where, documentId, getDocs, getDocsFromServer } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
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
  const cache=new Map();
  const maxMonths=6;
  if(isConfigured()){
    const app=getApps().length?getApps()[0]:initializeApp(firebaseConfig);
    db=getFirestore(app);
  }
  const keyOf=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  const monthFmt=new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"long"});
  const maxDate=()=>{const d=new Date(today);d.setMonth(d.getMonth()+maxMonths);return d;};
  async function states(first,last){
    const mk=monthKey(first); if(cache.has(mk))return cache.get(mk);
    if(!db){const m=new Map();cache.set(mk,m);return m;}
    const q=query(collection(db,"availability"),where(documentId(),">=",keyOf(first)),where(documentId(),"<=",keyOf(last)));
    let snap; try{snap=await getDocsFromServer(q);}catch{snap=await getDocs(q);}
    const m=new Map(snap.docs.map(d=>[d.id,d.data().status||"available"]));cache.set(mk,m);return m;
  }
  function label(state){return state==="booked"?"已預約":state==="blocked"?"暫停":"可詢問";}
  async function render(){
    const first=new Date(cursor.getFullYear(),cursor.getMonth(),1),last=new Date(cursor.getFullYear(),cursor.getMonth()+1,0);
    monthLabel.textContent=monthFmt.format(first);
    grid.replaceChildren();
    for(let i=0;i<first.getDay();i++){const e=document.createElement("span");e.className="calendar-empty";grid.append(e);}
    let map=new Map(); try{map=await states(first,last);}catch(e){console.warn("availability load failed",e);statusNode.textContent="日期狀況暫時無法載入，請直接到官方 LINE 詢問。";}
    for(let day=1;day<=last.getDate();day++){
      const d=new Date(cursor.getFullYear(),cursor.getMonth(),day),past=d<today,beyond=d>maxDate();
      const state=past||beyond?"blocked":(map.get(keyOf(d))||"available");
      const b=document.createElement("button");b.type="button";b.className=`calendar-day ${state}`;b.disabled=true;b.setAttribute("aria-label",`${keyOf(d)} ${label(state)}`);
      b.innerHTML=`<span>${day}</span><small>${past?"已過":beyond?"尚未開放":label(state)}</small>`;grid.append(b);
    }
    prevBtn.disabled=cursor.getFullYear()===today.getFullYear()&&cursor.getMonth()===today.getMonth();
    const nm=new Date(cursor.getFullYear(),cursor.getMonth()+1,1),max=maxDate();nextBtn.disabled=nm>new Date(max.getFullYear(),max.getMonth(),1);
  }
  prevBtn?.addEventListener("click",()=>{if(prevBtn.disabled)return;cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render();});
  nextBtn?.addEventListener("click",()=>{if(nextBtn.disabled)return;cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render();});
  render();
}
