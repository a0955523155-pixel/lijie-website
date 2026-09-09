import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, query, where, documentId, getDocs, getDocsFromServer } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./config.js";

const grid = document.querySelector("#publicCalendar");
if (grid) {
  const monthLabel = document.querySelector("#calendarMonth");
  const statusNode = document.querySelector("#calendarStatus");
  const selectedCard = document.querySelector("#selectedDateCard");
  const selectedText = document.querySelector("#selectedDateText");
  const selectedLine = document.querySelector("#selectedDateLine");
  const dateSheet = document.querySelector("#dateSheet");
  const dateSheetBackdrop = document.querySelector("#dateSheetBackdrop");
  const dateSheetTitle = document.querySelector("#dateSheetTitle");
  const dateSheetHint = document.querySelector("#dateSheetHint");
  const dateSheetLine = document.querySelector("#dateSheetLine");
  const dateSheetCopy = document.querySelector("#dateSheetCopy");
  const prevBtn = document.querySelector("#calendarPrev");
  const nextBtn = document.querySelector("#calendarNext");
  const bookingPageBaseUrl = "https://www.5-1bbs.com/line-booking.html";
  const formatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long" });
  const fullFormatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const money = new Intl.NumberFormat("zh-TW");
  const today = new Date(); today.setHours(0,0,0,0);
  let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  let startDate = null;
  let endDate = null;
  let selectedMessage = "";
  let selectedQuote = null;
  let db = null;
  const monthCache = new Map();
  const pricingMonthCache = new Map();
  let pricingSettings = { bookingWindowMonths: 6, maxBookableDate: null };

  if (isConfigured()) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    db = getFirestore(app);
  }

  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  const localDateFromKey = (key) => { const [y,m,d]=String(key).split("-").map(Number); return new Date(y,m-1,d); };
  const nightsBetween = (a,b) => Math.round((new Date(b.getFullYear(),b.getMonth(),b.getDate()) - new Date(a.getFullYear(),a.getMonth(),a.getDate())) / 86400000);
  const defaultMaxDate = () => { const d=new Date(today); d.setMonth(d.getMonth()+6); return d; };
  const maxBookableDate = () => pricingSettings.maxBookableDate ? localDateFromKey(pricingSettings.maxBookableDate) : defaultMaxDate();

  async function getMonthStates(first, last, { force = false } = {}) {
    const cacheKey = monthKey(first);
    if (!force && monthCache.has(cacheKey)) return monthCache.get(cacheKey);
    if (!db) { const empty = new Map(); monthCache.set(cacheKey, empty); return empty; }
    const q = query(collection(db, "availability"), where(documentId(), ">=", keyOf(first)), where(documentId(), "<=", keyOf(last)));
    let snap;
    try { snap = await getDocsFromServer(q); } catch { snap = await getDocs(q); }
    const result = new Map(snap.docs.map(d => [d.id, d.data().status || "available"]));
    monthCache.set(cacheKey, result);
    return result;
  }

  async function getMonthPricing(first,{force=false}={}){
    const key=monthKey(first);
    if(!force && pricingMonthCache.has(key)) return pricingMonthCache.get(key);
    try{
      const r=await fetch(`/api/public-pricing-calendar?month=${encodeURIComponent(key)}`,{cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const data=await r.json();
      if(data.settings) pricingSettings={...pricingSettings,...data.settings};
      const map=new Map((data.quote?.details||[]).map(x=>[x.date,x]));
      pricingMonthCache.set(key,map); return map;
    }catch(e){ console.warn("Pricing calendar unavailable",e); const empty=new Map(); pricingMonthCache.set(key,empty); return empty; }
  }

  async function quoteRange(start,end){
    try{
      const r=await fetch(`/api/public-pricing-calendar?start=${encodeURIComponent(keyOf(start))}&end=${encodeURIComponent(keyOf(end))}`,{cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const data=await r.json(); if(data.settings) pricingSettings={...pricingSettings,...data.settings}; return data.quote||null;
    }catch(e){ console.warn("Range quote unavailable",e); return null; }
  }

  async function rangeIsAvailable(start, end) {
    if (!db) return { ok:true };
    const startKey = keyOf(start);
    const lastNight = new Date(end); lastNight.setDate(lastNight.getDate()-1);
    const lastKey = keyOf(lastNight);
    const q = query(collection(db, "availability"), where(documentId(), ">=", startKey), where(documentId(), "<=", lastKey));
    let snap; try { snap = await getDocsFromServer(q); } catch { snap = await getDocs(q); }
    const blocked = new Map(snap.docs.map(d => [d.id, d.data().status || "available"]));
    const d = new Date(start);
    while (d < end) { const state = blocked.get(keyOf(d)) || "available"; if (state !== "available") return { ok:false, date:new Date(d), state }; d.setDate(d.getDate()+1); }
    return { ok:true };
  }

  function isSameDay(a,b){ return !!a && !!b && keyOf(a)===keyOf(b); }
  function isWithinRange(d){ return !!startDate && !!endDate && d > startDate && d < endDate; }
  function isBeyondWindow(d){ return d > maxBookableDate(); }
  function shortTag(label=""){
    if(label.includes("台灣祭")) return "台灣祭";
    if(label.includes("跨年")) return "跨年旺季";
    if(label.includes("春節")) return "春節";
    if(label.includes("連假")) return label.replace("連假","")||"連假";
    return label;
  }

  function closeDateSheet() {
    dateSheet?.classList.remove("open"); dateSheetBackdrop?.classList.remove("open");
    dateSheet?.setAttribute("aria-hidden", "true"); dateSheetBackdrop?.setAttribute("aria-hidden", "true");
  }

  function rangeLabel() {
    if (!startDate) return "尚未選擇";
    if (!endDate) return `${fullFormatter.format(startDate)}（入住）`;
    const quote=selectedQuote?.total ? `｜預估 NT$ ${money.format(selectedQuote.total)}` : "";
    return `${fullFormatter.format(startDate)} → ${fullFormatter.format(endDate)}${quote}`;
  }

  function buildMessage() {
    if (!startDate || !endDate) return "";
    const nights = nightsBetween(startDate,endDate);
    const quoteLine=selectedQuote?.total ? `\n系統試算：NT$ ${money.format(selectedQuote.total)}` : "";
    return `您好，我想詢問俐姐的家住宿預約\n入住日期：${keyOf(startDate)}\n退房日期：${keyOf(endDate)}\n住宿晚數：${nights} 晚${quoteLine}\n入住時間：15:00 起\n退房時間：12:00 前\n想確認這段日期是否可以預約，謝謝。`;
  }

  function miniAppBookingUrl() {
    if (!startDate || !endDate) return bookingPageBaseUrl;
    const params = new URLSearchParams({ start: keyOf(startDate), end: keyOf(endDate), source: "website" });
    return `${bookingPageBaseUrl}?${params.toString()}`;
  }

  function openRangeSheet() {
    if (!startDate || !endDate) return;
    const nights = nightsBetween(startDate,endDate); selectedMessage = buildMessage();
    if (dateSheetTitle) dateSheetTitle.textContent = `${keyOf(startDate)} → ${keyOf(endDate)}`;
    if (dateSheetHint) {
      const price=selectedQuote?.total ? `｜預估總價 NT$ ${money.format(selectedQuote.total)}` : "";
      dateSheetHint.textContent = `共 ${nights} 晚${price}｜入住 15:00 起｜退房 12:00 前。前往 LINE 後會自動帶入日期與同一套價格規則；最終金額以俐姐確認為準。`;
    }
    if (dateSheetLine) { dateSheetLine.href = miniAppBookingUrl(); dateSheetLine.removeAttribute("target"); }
    dateSheet?.classList.add("open"); dateSheetBackdrop?.classList.add("open"); dateSheet?.setAttribute("aria-hidden", "false"); dateSheetBackdrop?.setAttribute("aria-hidden", "false");
  }

  function updateSelectionUI() {
    if (!startDate) { selectedCard?.classList.add("hidden"); return; }
    selectedCard?.classList.remove("hidden"); if (selectedText) selectedText.textContent = rangeLabel();
    if (selectedLine) { selectedLine.href = endDate ? miniAppBookingUrl() : "#"; selectedLine.textContent = endDate ? "前往 LINE 完成預約 →" : "再選擇退房日期"; selectedLine.removeAttribute("target"); }
  }

  async function selectDate(d) {
    if(isBeyondWindow(d)){ statusNode.textContent=`目前僅開放未來 ${pricingSettings.bookingWindowMonths||6} 個月預約。`; return; }
    if (!startDate || endDate || d <= startDate) {
      startDate = new Date(d); endDate = null; selectedQuote=null;
      statusNode.textContent = "已選入住日，請再點選退房日期。"; updateSelectionUI(); await render(false); return;
    }
    endDate = new Date(d); statusNode.textContent = "正在確認住宿期間與試算價格…"; updateSelectionUI(); await render(false);
    try {
      if(isBeyondWindow(endDate)){ endDate=null; statusNode.textContent=`退房日期需在未來 ${pricingSettings.bookingWindowMonths||6} 個月內。`; updateSelectionUI(); await render(false); return; }
      const [check,quote]=await Promise.all([rangeIsAvailable(startDate,endDate),quoteRange(startDate,endDate)]);
      if (!check.ok) { const blockedDate = fullFormatter.format(check.date); endDate = null; selectedQuote=null; statusNode.textContent = `${blockedDate} 已不可預約，請重新選擇退房日期。`; updateSelectionUI(); await render(false); return; }
      selectedQuote=quote; const nights = nightsBetween(startDate,endDate);
      const price=quote?.total ? `，預估總價 NT$ ${money.format(quote.total)}` : "";
      statusNode.textContent = `已選 ${nights} 晚${price}。`;
      updateSelectionUI(); openRangeSheet();
    } catch (error) { console.warn("Range availability unavailable", error); statusNode.textContent = "目前無法完整驗證日期，請透過官方 LINE 再確認。"; openRangeSheet(); }
  }

  async function render(showLoading = true) {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1); const last = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
    monthLabel.textContent = formatter.format(first); grid.replaceChildren();
    if (showLoading) statusNode.textContent = startDate && !endDate ? "請選擇退房日期。" : "正在載入日期與價格…";
    let states = new Map(), prices=new Map();
    try {
      [states,prices]=await Promise.all([getMonthStates(first,last,{force:true}),getMonthPricing(first,{force:true})]);
      if (showLoading) statusNode.textContent = startDate && !endDate ? "已選入住日，請再點選退房日期。" : `先選入住日，再選退房日｜開放未來 ${pricingSettings.bookingWindowMonths||6} 個月。`;
    } catch (error) { console.warn("Calendar unavailable", error); if (showLoading) statusNode.textContent = "目前無法同步最新日期，請直接透過 LINE 詢問。"; }

    const max=maxBookableDate();
    if(prevBtn) prevBtn.disabled = cursor.getFullYear()===today.getFullYear() && cursor.getMonth()===today.getMonth();
    if(nextBtn){ const nextMonth=new Date(cursor.getFullYear(),cursor.getMonth()+1,1); nextBtn.disabled=nextMonth>new Date(max.getFullYear(),max.getMonth(),1); }

    const startOffset = first.getDay(); const start = new Date(first); start.setDate(1 - startOffset);
    for (let i=0; i<42; i++) {
      const d = new Date(start); d.setDate(start.getDate()+i); const key = keyOf(d); const state = states.get(key) || "available"; const rate=prices.get(key);
      const outside = d.getMonth() !== cursor.getMonth(); const past = d < today; const beyond=isBeyondWindow(d);
      const btn = document.createElement("button"); btn.type = "button";
      btn.className = `calendar-day ${outside ? "outside" : ""} ${past ? "past" : ""} ${beyond ? "future-locked" : ""} ${state}`.trim();
      if (key === keyOf(today)) btn.classList.add("today"); if (isSameDay(d,startDate)) btn.classList.add("range-start","selected"); if (isSameDay(d,endDate)) btn.classList.add("range-end","selected"); if (isWithinRange(d)) btn.classList.add("in-range");
      const labels = { available:"可預約", booked:"已預約", blocked:"暫停" };
      const selectionLabel = isSameDay(d,startDate) ? "入住" : isSameDay(d,endDate) ? "退房" : (isWithinRange(d) ? "住宿" : (beyond?"尚未開放":(labels[state] || "可預約")));
      const priceText = !outside && !past && !beyond && state==="available" && rate?.price ? `<span class="night-price">${money.format(rate.price)}</span>` : "";
      const tag = !outside && !past && !beyond && state==="available" && rate?.label && !['平日','週五','週六'].includes(rate.label) ? `<span class="rate-tag">${shortTag(rate.label)}</span>` : "";
      btn.innerHTML = `<span class="day-number">${d.getDate()}</span>${priceText}${tag}<span class="state">${selectionLabel}</span>`;
      btn.setAttribute("aria-label", `${fullFormatter.format(d)}，${selectionLabel}${rate?.price?`，每晚 ${money.format(rate.price)} 元`:''}${rate?.label?`，${rate.label}`:''}`);
      const canBeCheckout = !!startDate && !endDate && d > startDate && !beyond;
      btn.disabled = past || beyond || (!canBeCheckout && state !== "available");
      if (!btn.disabled) btn.addEventListener("click", () => selectDate(d)); grid.append(btn);
    }
  }

  prevBtn?.addEventListener("click", () => { if(prevBtn.disabled) return; cursor = new Date(cursor.getFullYear(), cursor.getMonth()-1, 1); render(); });
  nextBtn?.addEventListener("click", () => { if(nextBtn.disabled) return; cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1); render(); });
  document.querySelector("#dateSheetClose")?.addEventListener("click", closeDateSheet); dateSheetBackdrop?.addEventListener("click", closeDateSheet);
  document.querySelector("#dateSheetCalendar")?.addEventListener("click", () => { closeDateSheet(); document.querySelector("#booking")?.scrollIntoView({ behavior: "smooth", block: "center" }); });
  selectedLine?.addEventListener("click", (e) => { if (!endDate) e.preventDefault(); });
  dateSheetCopy?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(selectedMessage); dateSheetCopy.textContent = "已複製，可貼到 LINE ✓"; setTimeout(() => dateSheetCopy.textContent = "複製預約內容", 1800); } catch { dateSheetCopy.textContent = selectedMessage; } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDateSheet(); });
  window.addEventListener("focus", () => { monthCache.clear(); pricingMonthCache.clear(); render(false); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { monthCache.clear(); pricingMonthCache.clear(); render(false); } });
  updateSelectionUI(); render();
}
