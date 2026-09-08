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
    const chatReady = canSendToCurrentChat();
    els.mode.textContent = chatReady ? "已從官方 LINE 聊天室開啟・可直接送出" : (inLine ? "LINE MINI App 模式・請從官方 LINE 圖文選單完成送出" : "LINE 預約頁面");
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
  const chatReady = canSendToCurrentChat();
  const label = chatReady ? '<span>LINE</span> 傳送預約申請' : '<span>LINE</span> 前往官方 LINE 完成送出';
  els.send.innerHTML = label;
  if (chatReady) {
    els.status.dataset.mode = "chat";
  } else {
    els.status.dataset.mode = "handoff";
  }
}

function refreshForm(){
  const valid=!!(startDate&&endDate&&els.name.value.trim()); els.send.disabled=!valid;
  updateSendMode();
  if (valid) {
    els.status.textContent = canSendToCurrentChat()
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

async function ensureChatMessagePermission(){
  if (!liffReady || !inLine) return {ok:false, reason:"NOT_IN_LINE"};
  try {
    lineContext = window.liff.getContext?.() || lineContext;
    const type = lineContext?.type;
    if (!["utou","group","room"].includes(type)) {
      return {ok:false, reason:`NO_CHAT_CONTEXT:${type || "unknown"}`};
    }
    if (window.liff.isApiAvailable?.("sendMessages") === false) {
      return {ok:false, reason:"SEND_MESSAGES_API_UNAVAILABLE"};
    }
    // 不先呼叫 permission.query("chat_message.write")。
    // LINE MINI App 在需要 chat_message.write 時，sendMessages() 會自行顯示驗證／授權畫面。
    // 先 query 在部分 MINI App 環境會回 INVALID_ARGUMENT，反而阻斷真正送出。
    return {ok:true};
  } catch (e) {
    console.warn("LINE chat preflight failed", e);
    return {ok:false, reason:e?.code || e?.message || "CHAT_PREFLIGHT_FAILED"};
  }
}

async function ensureOfficialAccountFriend(){
  if (!liffReady || !window.liff?.isLoggedIn?.()) return false;
  try {
    const friendship = await window.liff.getFriendship?.();
    if (friendship?.friendFlag) return true;
  } catch (e) {
    console.warn("getFriendship failed", e);
  }
  try {
    if (typeof window.liff.requestFriendship === "function") {
      await window.liff.requestFriendship();
      const friendship = await window.liff.getFriendship?.();
      return !!friendship?.friendFlag;
    }
  } catch (e) {
    console.warn("requestFriendship failed", e);
  }
  return false;
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
    err.status = response.status;
    throw err;
  }
  return data;
}

async function sendMessage(){
  const msg=buildMessage(); if(!msg)return;
  els.send.disabled=true; els.status.textContent="正在處理預約申請…";
  try{
    saveDraft();

    // 只有「從俐姐的家官方 LINE 聊天室的 Rich Menu 開啟」才有聊天室 context。
    // 這時 liff.sendMessages() 才能讓預約內容真的以客人的訊息送進官方帳號聊天室。
    if(canSendToCurrentChat()){
      const permission = await ensureChatMessagePermission();
      if (!permission.ok) {
        const err = new Error(permission.reason);
        err.code = permission.reason;
        throw err;
      }
      await window.liff.sendMessages([{type:"text",text:msg}]);
      clearDraft();
      els.status.textContent="預約申請已送出 ✓ 官方 LINE 正在回覆確認資訊。";
      setTimeout(()=>{try{window.liff.closeWindow()}catch{}},900);
      return;
    }

    // 從官網/Safari 直接開 MINI App 時，LINE 不提供聊天室 context，不能冒充客人自動發訊息。
    // 將資料留在 MINI App 本機草稿，先進官方 LINE；客人從圖文選單再次開啟「立即預約」後，
    // 同一份資料會自動恢復，接著就能使用 liff.sendMessages() 真正送進聊天室。
    els.status.textContent="資料已保留。正在前往官方 LINE；請點圖文選單『立即預約』完成最後送出。";
    setTimeout(()=>{ window.location.href = lineConfig.officialLineUrl; }, 700);
  }catch(e){
    console.warn("LINE send failed", {code:e?.code, message:e?.message, context:lineContext});
    const reason = String(e?.code || e?.message || "");
    if (reason.includes("403") || reason.includes("required permissions") || reason.includes("PERMISSION")) {
      els.status.textContent="LINE 尚未授權『傳送訊息』權限。請確認 Developing 的 Scopes 已勾選 chat_message.write，重新開啟 MINI App 後允許授權，再按一次送出。";
    } else if (reason.includes("INVALID_ARGUMENT")) {
      els.status.textContent="LINE 回傳 INVALID_ARGUMENT。V6.21 已移除會造成此錯誤的權限預查；若仍出現，請確認 Rich Menu 使用 MINI App URL，且 Scopes 已勾選 chat_message.write。";
    } else if (reason.includes("NO_CHAT_CONTEXT")) {
      els.status.textContent="目前不是從官方 LINE 聊天室開啟。請回俐姐的家官方 LINE，從圖文選單『立即預約』重新開啟。";
    } else {
      els.status.textContent=`LINE 傳送未完成（${reason || "未知原因"}）。預約資料已保留，請從官方 LINE 圖文選單重新開啟後再送出。`;
    }
    saveDraft();
  } finally {
    setTimeout(refreshForm,2200);
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

const restoredDraft = loadDraft();
renderStayRules(); await initLiff(); await render(); updateSelection(); updateSendMode();
if (restoredDraft && canSendToCurrentChat() && startDate && endDate && els.name.value.trim()) {
  els.status.textContent = "已自動恢復剛才在官網填好的預約資料。確認無誤後，按下『LINE 傳送預約申請』即可送進官方聊天室。";
}
