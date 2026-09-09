import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, query, where, documentId, getDocs } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./config.js";
import { BOOKING_RULES } from "./booking-rules.js";

const $ = (s) => document.querySelector(s);
const els = {
  cal: $("#calendar"), month: $("#monthLabel"), prev: $("#prev"), next: $("#next"),
  start: $("#startText"), end: $("#endText"), note: $("#selectionNote"), error: $("#dateError"),
  name: $("#guestName"), phone: $("#phone"), email: $("#email"), people: $("#people"), purpose: $("#purpose"), notes: $("#notes"),
  send: $("#sendBtn"), copy: $("#copyBtn"), status: $("#sendStatus"), summary: $("#summary"), mode: $("#lineModeText"),
  checkInTime: $("#checkInTime"), checkOutTime: $("#checkOutTime"), stayRulesList: $("#stayRulesList"),
  quickStart: $("#lineCheckIn"), quickEnd: $("#lineCheckOut"), quickGuests: $("#lineGuests"), quickApply: $("#lineApplySelection")
};

const today = new Date(); today.setHours(0,0,0,0);
let params = null;
let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
let startDate = null, endDate = null, monthStates = new Map();
let currentQuote = null;
let pricingSettings = {bookingWindowMonths:6,maxBookableDate:null};
const pricingMonthCache = new Map();
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
const moneyFmt = new Intl.NumberFormat("zh-TW");
const maxBookableDate=()=>pricingSettings.maxBookableDate?parseKey(pricingSettings.maxBookableDate):(()=>{const d=new Date(today);d.setMonth(d.getMonth()+6);return d})();
const isBeyondWindow=(d)=>d>maxBookableDate();

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
  if(bookingSession){
    els.mode.textContent="官方 LINE 安全預約連線已建立";
    return true;
  }
  try{
    const r=await fetch("/api/line-session",{cache:"no-store",credentials:"same-origin"});
    const data=await r.json().catch(()=>({}));
    if(r.ok&&data?.authenticated){
      els.mode.textContent="官方 LINE 身分已連結";
      return true;
    }
  }catch(e){ console.warn("line session check failed",e); }
  els.mode.textContent="正在連結官方 LINE 身分…";
  els.status.textContent="第一次從預約日曆送出前，需要連結一次 LINE 身分。完成後會自動回到目前預約頁。";
  els.send.disabled=false;
  els.send.dataset.authRequired="1";
  els.send.innerHTML="<span>LINE</span> 連結身分並繼續預約";
  return false;
}

function startLineLogin(){
  saveDraft();
  const returnTo=`/line-booking.html${location.search||""}`;
  location.href=`/api/line-auth-start?return=${encodeURIComponent(returnTo)}`;
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


async function loadPricing(first){
  const mk=`${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,"0")}`;
  if(pricingMonthCache.has(mk)) return pricingMonthCache.get(mk);
  try{
    const r=await fetch(`/api/public-pricing-calendar?month=${encodeURIComponent(mk)}`,{cache:"no-store"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const data=await r.json(); if(data.settings) pricingSettings={...pricingSettings,...data.settings};
    const map=new Map((data.quote?.details||[]).map(x=>[x.date,x])); pricingMonthCache.set(mk,map); return map;
  }catch(e){console.warn("pricing unavailable",e); const map=new Map(); pricingMonthCache.set(mk,map); return map;}
}
async function quoteRange(a,b){
  try{
    const r=await fetch(`/api/public-pricing-calendar?start=${encodeURIComponent(keyOf(a))}&end=${encodeURIComponent(keyOf(b))}`,{cache:"no-store"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`); const data=await r.json(); if(data.settings) pricingSettings={...pricingSettings,...data.settings}; return data.quote||null;
  }catch(e){console.warn("range quote unavailable",e); return null;}
}
function isInRange(d){ if(!startDate) return false; const end=endDate||startDate; return d>=startDate&&d<=end; }
function stateOf(d){ return stateCache.get(keyOf(d)) || monthStates.get(keyOf(d)) || "available"; }

function drawCalendar(prices=new Map()){
  const first=new Date(cursor.getFullYear(),cursor.getMonth(),1);
  els.month.textContent=monthFmt.format(first); els.cal.replaceChildren();
  const start=new Date(first); start.setDate(1-first.getDay());
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i); const state=stateOf(d); const rate=prices.get(keyOf(d)); const outside=d.getMonth()!==cursor.getMonth(); const past=d<today; const beyond=isBeyondWindow(d);
    const b=document.createElement("button"); b.type="button"; b.className=`day ${outside?"outside":""} ${past?"past":""} ${beyond?"future-locked":""} ${state} ${isInRange(d)?"range":""}`;
    if ((startDate&&keyOf(d)===keyOf(startDate))||(endDate&&keyOf(d)===keyOf(endDate))) b.classList.add("selected");
    const rateText=(!outside&&!past&&!beyond&&state==="available"&&rate?.price)?`<em>${moneyFmt.format(rate.price)}</em>`:"";
    const tag=(!outside&&!past&&!beyond&&state==="available"&&rate?.label&&!['平日','週五','週六'].includes(rate.label))?`<i>${rate.label.replace('連假','')}</i>`:"";
    const status=beyond?"尚未開放":state==="available"?"可詢問":state==="booked"?"已預約":"暫停";
    b.innerHTML=`<span>${d.getDate()}</span>${rateText}${tag}<small>${status}</small>`;
    b.disabled=past||beyond||state!=="available"; if(!b.disabled)b.addEventListener("click",()=>pickDate(d)); els.cal.append(b);
  }
}
async function render(){
  const first=new Date(cursor.getFullYear(),cursor.getMonth(),1), last=new Date(cursor.getFullYear(),cursor.getMonth()+1,0);
  drawCalendar();
  const [states,prices]=await Promise.all([loadStates(first,last),loadPricing(first)]); monthStates=states;
  drawCalendar(prices);
  els.prev.disabled=cursor.getFullYear()===today.getFullYear()&&cursor.getMonth()===today.getMonth();
  const nm=new Date(cursor.getFullYear(),cursor.getMonth()+1,1), max=maxBookableDate(); els.next.disabled=nm>new Date(max.getFullYear(),max.getMonth(),1);
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
  if(isBeyondWindow(d)){showError(`目前僅開放未來 ${pricingSettings.bookingWindowMonths||6} 個月。`);return;}
  if(!startDate||endDate){
    startDate=new Date(d); endDate=null; currentQuote=null;
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
  const [ok,quote]=await Promise.all([rangeIsAvailable(startDate,lastNight),quoteRange(startDate,candidateEnd)]);
  if(!ok){
    endDate=null; currentQuote=null;
    showError("住宿期間有已預約或暫停開放的日期，請重新選擇退房日期。");
  } else { currentQuote=quote; }
  updateSelection(); await render();
}

function hideError(){els.error.classList.add("hidden")}
function showError(msg){els.error.textContent=msg;els.error.classList.remove("hidden")}
function nightsCount(){if(!startDate||!endDate)return 0;return Math.round((endDate-startDate)/86400000)}
function syncQuickSelector(){
  const min=keyOf(today), max=keyOf(maxBookableDate());
  if(els.quickStart){els.quickStart.min=min;els.quickStart.max=max;els.quickStart.value=startDate?keyOf(startDate):"";}
  if(els.quickEnd){els.quickEnd.min=startDate?keyOf(new Date(startDate.getFullYear(),startDate.getMonth(),startDate.getDate()+1)):min;els.quickEnd.max=max;els.quickEnd.value=endDate?keyOf(endDate):"";}
  if(els.quickGuests) els.quickGuests.value=els.people.value||"";
}
function updateSelection(){
  syncQuickSelector();
  els.start.textContent=startDate?fmt.format(startDate):"請選擇";els.end.textContent=endDate?fmt.format(endDate):"請選擇";
  els.note.textContent=startDate&&!endDate?"已選開始日期，請再點結束日期。":startDate&&endDate?`入住 ${nightsCount()} 晚；價格由俐姐確認後回覆。`:`先點入住日期，再點退房日期。開放未來 ${pricingSettings.bookingWindowMonths||6} 個月。`;
  refreshForm();
}

function renderStayRules(){
  els.checkInTime.textContent = BOOKING_RULES.checkInFrom;
  els.checkOutTime.textContent = BOOKING_RULES.checkOutBy;
  els.stayRulesList.innerHTML = BOOKING_RULES.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("");
}

function buildMessage(){
  if(!startDate||!endDate) return "";
  const name=els.name.value.trim(),phone=els.phone.value.trim(),email=els.email.value.trim(),people=els.people.value.trim(),purpose=els.purpose.value.trim(),notes=els.notes.value.trim();
  return [
    "【俐姐的家｜預約申請】",
    `入住：${keyOf(startDate)}`
    ,`退房：${keyOf(endDate)}（${nightsCount()} 晚）`,
    `姓名：${name||"未填"}`,
    `電話：${phone||"未填"}`,
    `Email：${email||"未填"}`,
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
      email: els.email.value.trim(),
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
    if (!els.email.value) els.email.value = draft.email || "";
    if (!els.people.value) els.people.value = draft.people || "";
    if (!els.purpose.value) els.purpose.value = draft.purpose || "";
    if (!els.notes.value) els.notes.value = draft.notes || "";
    return !!(startDate || draft.name || draft.phone || draft.email);
  } catch (e) { console.warn("booking draft load failed", e); return false; }
}

function clearDraft(){ try { localStorage.removeItem(DRAFT_KEY); } catch {} }

function updateSendMode(){
  const chatReady = Boolean(bookingSession||lineIdentityReady);
  const label = chatReady ? '<span>LINE</span> 傳送預約申請' : '<span>LINE</span> 請先從官方 LINE 開始';
  els.send.innerHTML = label;
  if (chatReady) {
    els.status.dataset.mode = "chat";
  } else {
    els.status.dataset.mode = "handoff";
  }
}

function refreshForm(){
  const valid=!!(startDate&&endDate&&els.name.value.trim()); els.send.disabled=!valid || !(bookingSession||lineIdentityReady);
  updateSendMode();
  if (valid) {
    els.status.textContent = Boolean(bookingSession||lineIdentityReady)
      ? "資料已整理好，可以送出預約申請。"
      : "第一次送出前需要先連結 LINE 身分。";
    saveDraft();
  } else {
    els.status.textContent="請先選擇完整日期並填寫姓名。";
  }
  const msg=buildMessage();
  if(msg){els.summary.innerHTML=`<div class="row"><span>入住</span><strong>${keyOf(startDate)}</strong></div><div class="row"><span>退房</span><strong>${keyOf(endDate)}</strong></div><div class="row"><span>住宿</span><strong>${nightsCount()} 晚</strong></div><div class="row"><span>姓名</span><strong>${escapeHtml(els.name.value.trim()||"—")}</strong></div><div class="row"><span>Email</span><strong>${escapeHtml(els.email.value.trim()||"—")}</strong></div>`;els.summary.classList.remove("hidden")}else els.summary.classList.add("hidden");
}
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

async function copyMessage(){const msg=buildMessage();if(!msg){els.status.textContent="請先選擇日期。";return}try{await navigator.clipboard.writeText(msg);els.status.textContent="已複製預約內容，可貼到官方 LINE。"}catch{els.status.textContent="瀏覽器無法自動複製，請長按選取內容。"}}


function emailIssue(raw){
  const email=String(raw||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "請輸入正確的 Email，例如 name@gmail.com。";
  const domain=email.split("@").pop();
  const typoMap={
    "gmail.con":"gmail.com","gmal.com":"gmail.com","gmial.com":"gmail.com","gmail.co":"gmail.com","gmail.om":"gmail.com",
    "hotmail.con":"hotmail.com","outlook.con":"outlook.com","yahoo.con":"yahoo.com"
  };
  if(typoMap[domain]) return `Email 網域看起來有誤：${domain}。你是不是要輸入 ${typoMap[domain]}？`;
  return "";
}

function bookingPayload(){
  return {
    checkIn: startDate ? keyOf(startDate) : "",
    checkOut: endDate ? keyOf(endDate) : "",
    name: els.name.value.trim(),
    phone: els.phone.value.trim(),
    email: els.email.value.trim(),
    people: els.people.value.trim(),
    purpose: els.purpose.value.trim(),
    notes: els.notes.value.trim(),
    source: "official-line-secure-link"
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
  const emailError=emailIssue(els.email.value);
  if(emailError){
    els.status.textContent=emailError;
    try{ els.email.focus(); }catch{}
    return;
  }
  els.send.disabled=true;
  els.status.textContent="正在把預約申請送回官方 LINE…";
  try {
    saveDraft();
    const result = await submitBookingToOfficialLine();
    clearDraft();
    if(result?.warning){
      els.status.textContent=`預約申請已送出 ✓ 編號 ${result.bookingId||""}。資料已安全保存；資料已安全保存，俐姐會由官網後台進行後續確認。`;
    }else{
      els.status.textContent=`預約申請已送出 ✓ 編號 ${result.bookingId||""}。請回官方 LINE 查看確認卡片。`;
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
    } else if (reason.includes("FIRESTORE_SAVE_FAILED")) {
      els.status.textContent="預約尚未寫入資料庫，請稍後再試；若持續出現，請聯絡俐姐。";
    } else if (reason.includes("BOOKING_SESSION_INVALID")) {
      els.status.textContent="目前預約連線已更新，請重新整理此頁或重新從官網／官方 LINE 進入，已填資料會保留。";
    } else if (reason.includes("BOOKING_OUTSIDE_WINDOW")) {
      els.status.textContent=`目前只開放未來 ${pricingSettings.bookingWindowMonths||6} 個月內預約，請重新選擇日期。`;
    } else if (reason.includes("EMAIL_DOMAIN_TYPO")) {
      els.status.textContent="Email 網域看起來有拼字錯誤，請確認是否為 gmail.com、hotmail.com、outlook.com 等正確網域。";
      try{ els.email.focus(); }catch{}
    } else if (reason.includes("EMAIL_REQUIRED")) {
      els.status.textContent="請輸入可正常收信的 Email。";
      try{ els.email.focus(); }catch{}
    } else {
      els.status.textContent=`送出未完成（${reason}）。已填日期與資料仍會保留，請重新整理後再送一次。`;
    }
    saveDraft();
    setTimeout(refreshForm,1800);
  }
}

async function applyLineQuickSelection(){
  hideError();
  const sKey=els.quickStart?.value||"", eKey=els.quickEnd?.value||"";
  if(els.quickGuests?.value) els.people.value=els.quickGuests.value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(sKey)){showError("請先選擇入住日期。");refreshForm();return;}
  const sDate=parseKey(sKey);
  if(sDate<today||isBeyondWindow(sDate)){showError(`入住日期需在未來 ${pricingSettings.bookingWindowMonths||6} 個月內。`);return;}
  startDate=sDate; endDate=null; currentQuote=null; cursor=new Date(sDate.getFullYear(),sDate.getMonth(),1);
  if(/^\d{4}-\d{2}-\d{2}$/.test(eKey)){
    const eDate=parseKey(eKey);
    if(eDate<=sDate||isBeyondWindow(eDate)){showError("退房日期需晚於入住日期，且需在開放期間內。");updateSelection();await render();return;}
    const lastNight=new Date(eDate); lastNight.setDate(lastNight.getDate()-1);
    const [ok,quote]=await Promise.all([rangeIsAvailable(sDate,lastNight),quoteRange(sDate,eDate)]);
    if(!ok){showError("住宿期間有已預約或暫停開放的日期，請重新選擇。");updateSelection();await render();return;}
    endDate=eDate; currentQuote=quote;
  }
  updateSelection(); await render();
  els.note.textContent=endDate?`已帶入 ${nightsCount()} 晚。`:`已帶入入住日期，請再選退房日期。`;
}
if(els.quickApply) els.quickApply.addEventListener("click",applyLineQuickSelection);
if(els.quickGuests) els.quickGuests.addEventListener("change",()=>{els.people.value=els.quickGuests.value;refreshForm();saveDraft();});
if(els.quickStart) els.quickStart.addEventListener("change",()=>{const k=els.quickStart.value;if(/^\d{4}-\d{2}-\d{2}$/.test(k)){const d=parseKey(k);cursor=new Date(d.getFullYear(),d.getMonth(),1);render();}});
if(els.quickEnd) els.quickEnd.addEventListener("change",()=>{if(els.quickStart?.value) applyLineQuickSelection();});

els.prev.addEventListener("click",()=>{if(els.prev.disabled)return;cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render()});
els.next.addEventListener("click",()=>{if(els.next.disabled)return;cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render()});
[els.name,els.phone,els.email,els.people,els.purpose,els.notes].forEach(e=>e.addEventListener("input",()=>{if(e===els.people&&els.quickGuests)els.quickGuests.value=els.people.value;refreshForm();saveDraft();}));
els.copy.addEventListener("click", copyMessage);
let submitInFlight = false;
async function triggerSend(e){
  if(e){ e.preventDefault(); e.stopPropagation(); }
  if(els.send.dataset.authRequired==="1" && !lineIdentityReady && !bookingSession){ startLineLogin(); return; }
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
  const presetGuests = params.get("guests");
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
  if (presetGuests && /^(?:[1-9]|1[0-2])$/.test(presetGuests)) els.people.value = presetGuests;
}

const restoredDraft = loadDraft();
renderStayRules();
readBookingSession();
lineIdentityReady = await ensureLineIdentity();
if(lineIdentityReady||bookingSession){ delete els.send.dataset.authRequired; }
applyPresetDates();
await render();
updateSelection();
if(lineIdentityReady||bookingSession) updateSendMode();
