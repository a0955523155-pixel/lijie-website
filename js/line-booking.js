import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, query, where, documentId, getDocs } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./config.js";
import { lineConfig, hasLiffId } from "./line-config.js";
import { BOOKING_RULES } from "./booking-rules.js";

const $ = (s) => document.querySelector(s);
const els = {
  cal: $("#calendar"), month: $("#monthLabel"), prev: $("#prev"), next: $("#next"),
  start: $("#startText"), end: $("#endText"), note: $("#selectionNote"), error: $("#dateError"),
  name: $("#guestName"), phone: $("#phone"), people: $("#people"), purpose: $("#purpose"), notes: $("#notes"),
  send: $("#sendBtn"), copy: $("#copyBtn"), status: $("#sendStatus"), summary: $("#summary"), mode: $("#lineModeText"),
  checkInTime: $("#checkInTime"), checkOutTime: $("#checkOutTime"), stayRulesList: $("#stayRulesList")
};

const today = new Date(); today.setHours(0,0,0,0);
const params = new URLSearchParams(location.search);
let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
let startDate = null, endDate = null, monthStates = new Map(), liffReady = false, inLine = false, lineContext = null;
const stateCache = new Map();
const loadedMonths = new Set();
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
    if (!window.liff.isLoggedIn()) {
      els.mode.textContent = "正在連接 LINE…";
      window.liff.login({ redirectUri: location.href });
      return;
    }
    liffReady = true;
    inLine = window.liff.isInClient();
    lineContext = window.liff.getContext?.() || null;
    els.mode.textContent = inLine ? "已在 LINE MINI App 內開啟" : "LINE 預約頁面";
  } catch (e) {
    console.warn("LIFF init failed", e); els.mode.textContent = "LINE 連線暫時不可用・仍可複製內容詢問";
  }
}

async function loadStates(first,last){
  const monthKey = `${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,"0")}`;
  if (loadedMonths.has(monthKey)) {
    const out = new Map();
    for (const [k,v] of stateCache) if (k >= keyOf(first) && k <= keyOf(last)) out.set(k,v);
    return out;
  }
  if (!db) { loadedMonths.add(monthKey); return new Map(); }
  try {
    const q = query(collection(db,"availability"), where(documentId(),">=",keyOf(first)), where(documentId(),"<=",keyOf(last)));
    const snap = await getDocs(q);
    const out = new Map(snap.docs.map(d=>[d.id,d.data().status||"available"]));
    out.forEach((v,k)=>stateCache.set(k,v));
    loadedMonths.add(monthKey);
    return out;
  } catch(e){ console.warn(e); return new Map(); }
}

function isInRange(d){ if(!startDate) return false; const end=endDate||startDate; return d>=startDate&&d<=end; }
function stateOf(d){ return stateCache.get(keyOf(d)) || monthStates.get(keyOf(d)) || "available"; }

function drawCalendar(){
  const first=new Date(cursor.getFullYear(),cursor.getMonth(),1);
  els.month.textContent=monthFmt.format(first); els.cal.replaceChildren();
  const start=new Date(first); start.setDate(1-first.getDay());
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i); const state=stateOf(d); const outside=d.getMonth()!==cursor.getMonth(); const past=d<today;
    const b=document.createElement("button"); b.type="button"; b.className=`day ${outside?"outside":""} ${past?"past":""} ${state} ${isInRange(d)?"range":""}`;
    if ((startDate&&keyOf(d)===keyOf(startDate))||(endDate&&keyOf(d)===keyOf(endDate))) b.classList.add("selected");
    b.innerHTML=`<span>${d.getDate()}</span><small>${state==="available"?"可詢問":state==="booked"?"已預約":"暫停"}</small>`;
    b.disabled=past||state!=="available"; if(!b.disabled)b.addEventListener("click",()=>pickDate(d)); els.cal.append(b);
  }
}

async function render(){
  const first=new Date(cursor.getFullYear(),cursor.getMonth(),1), last=new Date(cursor.getFullYear(),cursor.getMonth()+1,0);
  drawCalendar(); // 先立即畫出，避免 LINE MINI App 點擊後等待網路才有反應
  monthStates=await loadStates(first,last);
  drawCalendar();
}

async function rangeIsAvailable(a,b){
  const start=new Date(a), end=new Date(b); const months=[]; let c=new Date(start.getFullYear(),start.getMonth(),1);
  while(c<=end){months.push(new Date(c));c=new Date(c.getFullYear(),c.getMonth()+1,1)}
  // 已載入的月份直接吃快取；只有跨到尚未載入月份才查 Firestore。
  for(const m of months){
    const first=new Date(m.getFullYear(),m.getMonth(),1),last=new Date(m.getFullYear(),m.getMonth()+1,0);
    await loadStates(first,last);
  }
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){if((stateCache.get(keyOf(d))||"available")!=="available")return false;}
  return true;
}

async function pickDate(d){
  hideError();
  if(!startDate||endDate){
    startDate=new Date(d); endDate=null;
    updateSelection(); drawCalendar();
    return;
  }
  if(d<=startDate){
    startDate=new Date(d); endDate=null;
    showError("退房日期需晚於入住日期，請再選一天。");
    updateSelection(); drawCalendar();
    return;
  }

  // 先立即顯示客人點到的退房日，再做必要的跨月可用性檢查。
  const candidateEnd = new Date(d);
  endDate = candidateEnd;
  updateSelection(); drawCalendar();

  const lastNight=new Date(candidateEnd); lastNight.setDate(lastNight.getDate()-1);
  els.note.textContent = "正在確認住宿期間是否可預約…";
  const ok=await rangeIsAvailable(startDate,lastNight);
  if(!ok){
    endDate=null;
    showError("住宿期間有已預約或暫停開放的日期，請重新選擇退房日期。");
  }
  updateSelection(); drawCalendar();
}

function hideError(){els.error.classList.add("hidden")}
function showError(msg){els.error.textContent=msg;els.error.classList.remove("hidden")}
function nightsCount(){if(!startDate||!endDate)return 0;return Math.round((endDate-startDate)/86400000)}
function updateSelection(){
  els.start.textContent=startDate?fmt.format(startDate):"請選擇";els.end.textContent=endDate?fmt.format(endDate):"請選擇";
  els.note.textContent=startDate&&!endDate?"已選開始日期，請再點結束日期。":startDate&&endDate?`入住 ${nightsCount()} 晚；送出前仍會以官方 LINE 最終確認。`:"先點入住日期，再點退房日期。已預約或暫停開放的日期無法選取。";
  refreshForm();
}

function renderStayRules(){
  els.checkInTime.textContent = BOOKING_RULES.checkInFrom;
  els.checkOutTime.textContent = BOOKING_RULES.checkOutBy;
  els.stayRulesList.innerHTML = BOOKING_RULES.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("");
}

function buildMessage(){
  if(!startDate||!endDate) return "";
  const name=els.name.value.trim(),phone=els.phone.value.trim(),people=els.people.value.trim(),purpose=els.purpose.value.trim(),notes=els.notes.value.trim();
  return [
    "【俐姐的家｜預約申請】",
    `入住：${keyOf(startDate)}`
    ,`退房：${keyOf(endDate)}（${nightsCount()} 晚）`,
    `姓名：${name||"未填"}`,
    `電話：${phone||"未填"}`,
    `人數：${people?people+" 人":"未填"}`,
    `需求：${purpose||"未填"}`,
    `備註：${notes||"無"}`,
    "",
    "【入住須知】",
    `最早入住：${BOOKING_RULES.checkInFrom}`,
    `最晚退房：${BOOKING_RULES.checkOutBy}`,
    ...BOOKING_RULES.notes.map(n => `• ${n}`),
    "",
    "此為預約申請，請協助確認日期與安排，謝謝。"
  ].join("\n");
}

function refreshForm(){
  const valid=!!(startDate&&endDate&&els.name.value.trim()); els.send.disabled=!valid;
  els.status.textContent=valid?"資料已整理好，可傳送到官方 LINE。":"請先選擇完整日期並填寫姓名。";
  const msg=buildMessage();
  if(msg){els.summary.innerHTML=`<div class="row"><span>入住</span><strong>${keyOf(startDate)}</strong></div><div class="row"><span>退房</span><strong>${keyOf(endDate)}</strong></div><div class="row"><span>住宿</span><strong>${nightsCount()} 晚</strong></div><div class="row"><span>姓名</span><strong>${escapeHtml(els.name.value.trim()||"—")}</strong></div>`;els.summary.classList.remove("hidden")}else els.summary.classList.add("hidden");
}
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

async function copyMessage(){const msg=buildMessage();if(!msg){els.status.textContent="請先選擇日期。";return}try{await navigator.clipboard.writeText(msg);els.status.textContent="已複製預約內容，可貼到官方 LINE。"}catch{els.status.textContent="瀏覽器無法自動複製，請長按選取內容。"}}

function bookingPayload(){
  return {
    checkIn: keyOf(startDate),
    checkOut: keyOf(endDate),
    nights: nightsCount(),
    name: els.name.value.trim(),
    phone: els.phone.value.trim(),
    people: els.people.value.trim(),
    purpose: els.purpose.value.trim(),
    notes: els.notes.value.trim(),
    source: params.get("source") || "miniapp"
  };
}

function canSendToCurrentChat(){
  if (!liffReady || !inLine) return false;
  const type = lineContext?.type;
  return ["utou","group","room"].includes(type) && window.liff.isApiAvailable?.("sendMessages") !== false;
}

async function submitViaOfficialAccount(){
  if (!liffReady || !window.liff.isLoggedIn()) throw new Error("LINE_LOGIN_REQUIRED");
  const idToken = window.liff.getIDToken?.();
  if (!idToken) throw new Error("LINE_ID_TOKEN_UNAVAILABLE");
  const response = await fetch("/api/line-booking-submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, booking: bookingPayload() })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error || `BOOKING_SUBMIT_${response.status}`);
    err.code = data?.code;
    throw err;
  }
  return data;
}

async function sendMessage(){
  const msg=buildMessage(); if(!msg)return;
  els.send.disabled=true; els.status.textContent="正在送出預約申請…";
  try{
    // 從官方帳號聊天室的 Rich Menu 開啟時：由客人本人送出訊息，Webhook 立即自動回覆。
    if(canSendToCurrentChat()){
      await window.liff.sendMessages([{type:"text",text:msg}]);
      els.status.textContent="已送出預約申請，官方 LINE 會立即回覆您。";
      setTimeout(()=>{try{window.liff.closeWindow()}catch{}},1000);
      return;
    }

    // 從官網直接導入 MINI App 時沒有聊天室 context，改由後端安全驗證 LINE ID Token，
    // 再由官方帳號 Messaging API 回覆同一位客人。
    await submitViaOfficialAccount();
    els.status.textContent="預約申請已送出，官方 LINE 已回覆您的日期與入住須知。";
    setTimeout(()=>{
      try { window.location.href = lineConfig.officialLineUrl; } catch {}
    }, 1200);
  }catch(e){
    console.warn(e);
    await navigator.clipboard.writeText(msg).catch(()=>{});
    if (e?.code === "LINE_PUSH_FAILED") {
      els.status.textContent="請先加入俐姐的家官方 LINE；加入後回到此頁再按一次送出。";
      setTimeout(()=>{ window.location.href=lineConfig.officialLineUrl; },900);
    } else {
      els.status.textContent="目前無法自動送出，已幫你複製預約內容；請貼到官方 LINE。";
      setTimeout(()=>{ window.location.href=lineConfig.officialLineUrl; },900);
    }
  } finally {
    setTimeout(refreshForm,2200);
  }
}

els.prev.addEventListener("click",()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render()});
els.next.addEventListener("click",()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render()});
[els.name,els.phone,els.people,els.purpose,els.notes].forEach(e=>e.addEventListener("input",refreshForm));
els.copy.addEventListener("click",copyMessage);els.send.addEventListener("click",sendMessage);

const presetStart = params.get("start");
const presetEnd = params.get("end");
if (presetStart && /^\d{4}-\d{2}-\d{2}$/.test(presetStart)) {
  const d = parseKey(presetStart);
  if (d >= today) {
    startDate = d; cursor = new Date(d.getFullYear(), d.getMonth(), 1);
  }
}
if (presetEnd && /^\d{4}-\d{2}-\d{2}$/.test(presetEnd)) {
  const d = parseKey(presetEnd);
  if (startDate && d > startDate) endDate = d;
}

renderStayRules(); await initLiff(); await render(); updateSelection();
