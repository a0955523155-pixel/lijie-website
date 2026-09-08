import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, query, where, documentId, getDocs } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./config.js";
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
let params = null;
let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
let startDate = null, endDate = null, monthStates = new Map();
let bookingSession = null;
let lineIdentityReady = false;
const DRAFT_KEY = "lijie-line-booking-draft-v1";
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

function readBookingSession(){
  const p = new URLSearchParams(location.search);
  bookingSession = p.get("session") || ""; // 保留 V6.29 安全連結相容性
  if (bookingSession) {
    els.mode.textContent = "官方 LINE 安全預約連線已建立";
    return true;
  }
  return false;
}

async function ensureLineIdentity(){
  if (bookingSession) return true;
  try {
    const r = await fetch("/api/line-session", {cache:"no-store", credentials:"same-origin"});
    const data = await r.json().catch(()=>({}));
    if (r.ok && data.authenticated) {
      els.mode.textContent = "已連結您的 LINE 帳號";
      return true;
    }
  } catch (e) { console.warn("LINE session check failed", e); }

  const p = new URLSearchParams(location.search);
  if (p.get("lineAuth") === "error") {
    els.mode.textContent = "LINE 身分驗證失敗，請重新連結";
    els.status.textContent = "需要先連結 LINE 身分，送出後才能把預約確認送回您的官方 LINE 聊天室。";
    return false;
  }
  els.mode.textContent = "正在連結您的 LINE 帳號…";
  const returnTo = location.pathname + (location.search && !location.search.includes("lineAuth=") ? location.search : "");
  location.replace(`/api/line-auth-start?return=${encodeURIComponent(returnTo)}`);
  return false;
}

function openOfficialLine(){
  window.location.href = "https://line.me/R/oaMessage/%40287ppyfa";
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

function saveDraft(){
  try {
    const draft = {
      checkIn: startDate ? keyOf(startDate) : "",
      checkOut: endDate ? keyOf(endDate) : "",
      name: els.name.value.trim(),
      phone: els.phone.value.trim(),
      people: els.people.value.trim(),
      purpose: els.purpose.value.trim(),
      notes: els.notes.value.trim(),
      savedAt: Date.now()
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (e) { console.warn("booking draft save failed", e); }
}

function loadDraft(){
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft || !draft.savedAt || Date.now() - Number(draft.savedAt) > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(DRAFT_KEY); return false;
    }
    if (!startDate && /^\d{4}-\d{2}-\d{2}$/.test(draft.checkIn || "")) startDate = parseKey(draft.checkIn);
    if (!endDate && startDate && /^\d{4}-\d{2}-\d{2}$/.test(draft.checkOut || "")) {
      const d = parseKey(draft.checkOut); if (d > startDate) endDate = d;
    }
    if (startDate) cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    if (!els.name.value) els.name.value = draft.name || "";
    if (!els.phone.value) els.phone.value = draft.phone || "";
    if (!els.people.value) els.people.value = draft.people || "";
    if (!els.purpose.value) els.purpose.value = draft.purpose || "";
    if (!els.notes.value) els.notes.value = draft.notes || "";
    return !!(startDate || draft.name || draft.phone);
  } catch (e) { console.warn("booking draft load failed", e); return false; }
}

function clearDraft(){ try { localStorage.removeItem(DRAFT_KEY); } catch {} }

function updateSendMode(){
  const chatReady = Boolean(bookingSession || lineIdentityReady);
  const label = chatReady ? '<span>LINE</span> 傳送預約申請' : '<span>LINE</span> 請先從官方 LINE 開始';
  els.send.innerHTML = label;
  if (chatReady) {
    els.status.dataset.mode = "chat";
  } else {
    els.status.dataset.mode = "handoff";
  }
}

function refreshForm(){
  const valid=!!(startDate&&endDate&&els.name.value.trim()); els.send.disabled=!valid || !(bookingSession || lineIdentityReady);
  updateSendMode();
  if (valid) {
    els.status.textContent = Boolean(bookingSession || lineIdentityReady)
      ? "資料已整理好，現在可直接傳送到『俐姐的家』官方 LINE。"
      : "資料已保留。按下後會前往官方 LINE；請從圖文選單點『立即預約』，回到這裡即可真正送出。";
    saveDraft();
  } else {
    els.status.textContent="請先選擇完整日期並填寫姓名。";
  }
  const msg=buildMessage();
  if(msg){els.summary.innerHTML=`<div class="row"><span>入住</span><strong>${keyOf(startDate)}</strong></div><div class="row"><span>退房</span><strong>${keyOf(endDate)}</strong></div><div class="row"><span>住宿</span><strong>${nightsCount()} 晚</strong></div><div class="row"><span>姓名</span><strong>${escapeHtml(els.name.value.trim()||"—")}</strong></div>`;els.summary.classList.remove("hidden")}else els.summary.classList.add("hidden");
}
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

async function copyMessage(){const msg=buildMessage();if(!msg){els.status.textContent="請先選擇日期。";return}try{await navigator.clipboard.writeText(msg);els.status.textContent="已複製預約內容，可貼到官方 LINE。"}catch{els.status.textContent="瀏覽器無法自動複製，請長按選取內容。"}}

function bookingPayload(){
  return {
    checkIn: startDate ? keyOf(startDate) : "",
    checkOut: endDate ? keyOf(endDate) : "",
    name: els.name.value.trim(),
    phone: els.phone.value.trim(),
    people: els.people.value.trim(),
    purpose: els.purpose.value.trim(),
    notes: els.notes.value.trim(),
    source: bookingSession ? "official-line-secure-link" : "direct-calendar-line-login"
  };
}

async function submitBookingToOfficialLine(){
  const response = await fetch("/api/line-booking-submit", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ session: bookingSession, booking: bookingPayload() }),
    cache: "no-store",
    credentials: "same-origin"
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) {
    const err = new Error(data?.error || `BOOKING_SUBMIT_${response.status}`);
    err.code = data?.code || err.message;
    err.status = response.status;
    throw err;
  }
  return data;
}

async function sendMessage(){
  const msg=buildMessage(); if(!msg)return;
  els.send.disabled=true;
  els.status.textContent="正在把預約申請送回官方 LINE…";
  try {
    saveDraft();
    const result = await submitBookingToOfficialLine();
    clearDraft();
    if(result?.warning === "CUSTOMER_LINE_PUSH_FAILED"){
      els.status.textContent="預約已送達俐姐管理端 ✓ 管理者確認／取消按鈕已送出；目前客戶 LINE 身分無法由 Messaging API 直接回覆，請檢查 LINE Login 與 Messaging API 是否位於同一個 Provider。";
    }else{
      els.status.textContent="預約申請已送出 ✓ 請回官方 LINE 查看確認卡片。";
    }
    els.send.textContent="已送出預約申請";
    els.send.disabled=true;
    setTimeout(openOfficialLine, 1100);
  } catch (e) {
    console.warn("booking submit failed", e);
    const reason=String(e?.code || e?.message || "UNKNOWN");
    if (reason.includes("BOOKING_SESSION_REQUIRED")) {
      els.status.textContent="這個頁面不是從官方 LINE 的安全預約入口開啟。請回官方 LINE，點圖文選單『立即預約』重新開始。";
    } else if (reason.includes("BOOKING_SESSION_EXPIRED")) {
      els.status.textContent="這組預約連結已過期。請回官方 LINE 再點一次『立即預約』取得新連結。";
    } else if (reason.includes("LINE_PUSH_FAILED")) {
      els.status.textContent="預約資料已送到系統，但 LINE 無法回覆這個帳號。請確認沒有封鎖俐姐的家官方 LINE，再重新送出。";
    } else {
      els.status.textContent=`送出未完成（${reason}）。請回官方 LINE 點『立即預約』重新取得安全連結。`;
    }
    saveDraft();
    setTimeout(refreshForm,1800);
  }
}

els.prev.addEventListener("click",()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render()});
els.next.addEventListener("click",()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render()});
[els.name,els.phone,els.people,els.purpose,els.notes].forEach(e=>e.addEventListener("input",()=>{refreshForm();saveDraft();}));
els.copy.addEventListener("click", copyMessage);
let submitInFlight = false;
async function triggerSend(e){
  if(e){ e.preventDefault(); e.stopPropagation(); }
  if(submitInFlight || els.send.disabled) return;
  submitInFlight = true;
  // iOS Safari / LINE 內建瀏覽器在鍵盤開啟時，第一下常只負責收鍵盤。
  // 先主動 blur，再直接執行送出，避免看起來「按了沒反應」。
  try { document.activeElement?.blur?.(); } catch {}
  els.send.classList.add("sending");
  try { await sendMessage(); } finally {
    submitInFlight = false;
    els.send.classList.remove("sending");
  }
}
els.send.addEventListener("pointerup", triggerSend);
els.send.addEventListener("click", triggerSend);
els.send.addEventListener("touchend", triggerSend, {passive:false});

function applyPresetDates(){
  params = new URLSearchParams(location.search);
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
}

const restoredDraft = loadDraft();
renderStayRules();
readBookingSession();
lineIdentityReady = await ensureLineIdentity();
if (lineIdentityReady || bookingSession) {
  applyPresetDates();
  await render();
  updateSelection();
  updateSendMode();
}
