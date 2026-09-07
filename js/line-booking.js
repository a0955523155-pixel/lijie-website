import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, query, where, documentId, getDocs } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./config.js";
import { lineConfig, hasLiffId } from "./line-config.js";

const $ = (s) => document.querySelector(s);
const els = {
  cal: $("#calendar"), month: $("#monthLabel"), prev: $("#prev"), next: $("#next"),
  start: $("#startText"), end: $("#endText"), note: $("#selectionNote"), error: $("#dateError"),
  name: $("#guestName"), phone: $("#phone"), people: $("#people"), purpose: $("#purpose"), notes: $("#notes"),
  send: $("#sendBtn"), copy: $("#copyBtn"), status: $("#sendStatus"), summary: $("#summary"), mode: $("#lineModeText")
};

const today = new Date(); today.setHours(0,0,0,0);
let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
let startDate = null, endDate = null, monthStates = new Map(), liffReady = false, inLine = false;
let db = null;
if (isConfigured()) {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  db = getFirestore(app);
}

const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const parseKey = (k) => { const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); };
const fmt = new Intl.DateTimeFormat("zh-TW", {month:"short", day:"numeric", weekday:"short"});
const monthFmt = new Intl.DateTimeFormat("zh-TW", {year:"numeric", month:"long"});

async function initLiff(){
  if (!window.liff) { els.mode.textContent = "一般瀏覽器預約模式"; return; }
  if (!hasLiffId()) { els.mode.textContent = "LINE 頁面已完成・等待填入 LIFF ID"; return; }
  try {
    await window.liff.init({ liffId: lineConfig.liffId });
    liffReady = true; inLine = window.liff.isInClient();
    els.mode.textContent = inLine ? "已在官方 LINE 內開啟" : "LINE 預約頁面";
  } catch (e) {
    console.warn("LIFF init failed", e); els.mode.textContent = "LINE 連線暫時不可用・仍可複製內容詢問";
  }
}

async function loadStates(first,last){
  if (!db) return new Map();
  try {
    const q = query(collection(db,"availability"), where(documentId(),">=",keyOf(first)), where(documentId(),"<=",keyOf(last)));
    const snap = await getDocs(q); return new Map(snap.docs.map(d=>[d.id,d.data().status||"available"]));
  } catch(e){ console.warn(e); return new Map(); }
}

function isInRange(d){ if(!startDate) return false; const end=endDate||startDate; return d>=startDate&&d<=end; }
function stateOf(d){ return monthStates.get(keyOf(d))||"available"; }

async function render(){
  const first=new Date(cursor.getFullYear(),cursor.getMonth(),1), last=new Date(cursor.getFullYear(),cursor.getMonth()+1,0);
  els.month.textContent=monthFmt.format(first); monthStates=await loadStates(first,last); els.cal.replaceChildren();
  const start=new Date(first); start.setDate(1-first.getDay());
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i); const state=stateOf(d); const outside=d.getMonth()!==cursor.getMonth(); const past=d<today;
    const b=document.createElement("button"); b.type="button"; b.className=`day ${outside?"outside":""} ${past?"past":""} ${state} ${isInRange(d)?"range":""}`;
    if ((startDate&&keyOf(d)===keyOf(startDate))||(endDate&&keyOf(d)===keyOf(endDate))) b.classList.add("selected");
    b.innerHTML=`<span>${d.getDate()}</span><small>${state==="available"?"可詢問":state==="booked"?"已預約":"暫停"}</small>`;
    b.disabled=past||state!=="available"; if(!b.disabled)b.addEventListener("click",()=>pickDate(d)); els.cal.append(b);
  }
}

async function rangeIsAvailable(a,b){
  const start=new Date(a), end=new Date(b); const months=[]; let c=new Date(start.getFullYear(),start.getMonth(),1);
  while(c<=end){months.push(new Date(c));c=new Date(c.getFullYear(),c.getMonth()+1,1)}
  const all=new Map();
  for(const m of months){const first=new Date(m.getFullYear(),m.getMonth(),1),last=new Date(m.getFullYear(),m.getMonth()+1,0);const s=await loadStates(first,last);s.forEach((v,k)=>all.set(k,v));}
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){if((all.get(keyOf(d))||"available")!=="available")return false;}
  return true;
}

async function pickDate(d){
  hideError();
  if(!startDate||endDate){startDate=new Date(d);endDate=null;}
  else if(d<startDate){startDate=new Date(d);endDate=null;}
  else {
    const ok=await rangeIsAvailable(startDate,d);
    if(!ok){showError("這段日期中有已預約或暫停開放的日期，請重新選擇。");startDate=new Date(d);endDate=null;}
    else endDate=new Date(d);
  }
  updateSelection(); await render();
}

function hideError(){els.error.classList.add("hidden")}
function showError(msg){els.error.textContent=msg;els.error.classList.remove("hidden")}
function daysCount(){if(!startDate||!endDate)return 0;return Math.round((endDate-startDate)/86400000)+1}
function updateSelection(){
  els.start.textContent=startDate?fmt.format(startDate):"請選擇";els.end.textContent=endDate?fmt.format(endDate):"請選擇";
  els.note.textContent=startDate&&!endDate?"已選開始日期，請再點結束日期。":startDate&&endDate?`共選擇 ${daysCount()} 天；送出前仍會以官方 LINE 最終確認。`:"先點開始日期，再點結束日期；若只詢問單日，可連續點同一天兩次。";
  refreshForm();
}

function buildMessage(){
  if(!startDate||!endDate) return "";
  const name=els.name.value.trim(),phone=els.phone.value.trim(),people=els.people.value.trim(),purpose=els.purpose.value.trim(),notes=els.notes.value.trim();
  return [
    "【俐姐的家｜預約申請】",
    `日期：${keyOf(startDate)} ～ ${keyOf(endDate)}（${daysCount()} 天）`,
    `姓名：${name||"未填"}`,
    `電話：${phone||"未填"}`,
    `人數：${people?people+" 人":"未填"}`,
    `活動：${purpose||"未填"}`,
    `備註：${notes||"無"}`,
    "",
    "此為預約申請，請協助確認日期與安排，謝謝。"
  ].join("\n");
}

function refreshForm(){
  const valid=!!(startDate&&endDate&&els.name.value.trim()); els.send.disabled=!valid;
  els.status.textContent=valid?"資料已整理好，可傳送到官方 LINE。":"請先選擇完整日期並填寫姓名。";
  const msg=buildMessage();
  if(msg){els.summary.innerHTML=`<div class="row"><span>日期</span><strong>${keyOf(startDate)} ～ ${keyOf(endDate)}</strong></div><div class="row"><span>天數</span><strong>${daysCount()} 天</strong></div><div class="row"><span>姓名</span><strong>${escapeHtml(els.name.value.trim()||"—")}</strong></div>`;els.summary.classList.remove("hidden")}else els.summary.classList.add("hidden");
}
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

async function copyMessage(){const msg=buildMessage();if(!msg){els.status.textContent="請先選擇日期。";return}try{await navigator.clipboard.writeText(msg);els.status.textContent="已複製預約內容，可貼到官方 LINE。"}catch{els.status.textContent="瀏覽器無法自動複製，請長按選取內容。"}}

async function sendMessage(){
  const msg=buildMessage(); if(!msg)return;
  els.send.disabled=true; els.status.textContent="正在準備 LINE 預約訊息…";
  try{
    if(liffReady&&inLine){
      await window.liff.sendMessages([{type:"text",text:msg}]);
      els.status.textContent="已傳送到 LINE 聊天室，請等待俐姐確認。";
      setTimeout(()=>{try{window.liff.closeWindow()}catch{}},900);
    } else {
      await navigator.clipboard.writeText(msg).catch(()=>{});
      els.status.textContent="已複製預約內容，現在為你開啟官方 LINE，貼上訊息即可。";
      window.location.href=lineConfig.officialLineUrl;
    }
  }catch(e){console.warn(e);await navigator.clipboard.writeText(msg).catch(()=>{});els.status.textContent="無法直接傳送，已幫你複製內容；請貼到官方 LINE。";window.location.href=lineConfig.officialLineUrl;}
  finally{setTimeout(refreshForm,1200)}
}

els.prev.addEventListener("click",()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render()});
els.next.addEventListener("click",()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render()});
[els.name,els.phone,els.people,els.purpose,els.notes].forEach(e=>e.addEventListener("input",refreshForm));
els.copy.addEventListener("click",copyMessage);els.send.addEventListener("click",sendMessage);

await initLiff(); await render(); updateSelection();
