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
  const checkInInput = document.querySelector("#websiteCheckIn");
  const checkOutInput = document.querySelector("#websiteCheckOut");
  const guestsSelect = document.querySelector("#websiteGuests");
  const applySelectionBtn = document.querySelector("#websiteApplySelection");
  const selectedCheckIn = document.querySelector("#selectedCheckIn");
  const selectedCheckOut = document.querySelector("#selectedCheckOut");
  const selectedGuests = document.querySelector("#selectedGuests");
  const selectedNights = document.querySelector("#selectedNights");
  const websiteBookingDetail = document.querySelector("#websiteBookingDetail");
  const websiteBookingPriceLines = document.querySelector("#websiteBookingPriceLines");
  const websiteBookingTotal = document.querySelector("#websiteBookingTotal");
  const calendarCard = document.querySelector(".calendar-card");
  const bookingPageBaseUrl = "https://www.5-1bbs.com/line-booking.html";
  const formatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long" });
  const fullFormatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const money = new Intl.NumberFormat("zh-TW");
  const today = new Date(); today.setHours(0,0,0,0);
  let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  let startDate = null;
  let endDate = null;
  let guests = "";
  let renderSeq = 0;
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
  const draftKey = "lijieWebsiteBookingDraftV648";
  function saveWebsiteDraft(){
    try{localStorage.setItem(draftKey,JSON.stringify({start:startDate?keyOf(startDate):"",end:endDate?keyOf(endDate):"",guests:String(guests||"")}));}catch{}
  }
  function loadWebsiteDraft(){
    try{const d=JSON.parse(localStorage.getItem(draftKey)||"{}"); if(/^\d{4}-\d{2}-\d{2}$/.test(d.start||"")) startDate=localDateFromKey(d.start); if(startDate&&/^\d{4}-\d{2}-\d{2}$/.test(d.end||"")){const e=localDateFromKey(d.end);if(e>startDate)endDate=e;} if(/^(?:[1-9]|1[0-2])$/.test(String(d.guests||"")))guests=String(d.guests); if(startDate)cursor=new Date(startDate.getFullYear(),startDate.getMonth(),1);}catch{}
  }
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
    return `${fullFormatter.format(startDate)} → ${fullFormatter.format(endDate)}`;
  }

  function buildMessage() {
    if (!startDate || !endDate) return "";
    const nights = nightsBetween(startDate,endDate);
    return `您好，我想詢問俐姐的家住宿預約\n入住日期：${keyOf(startDate)}\n退房日期：${keyOf(endDate)}\n住宿晚數：${nights} 晚\n入住時間：15:00 起\n退房時間：12:00 前\n想確認這段日期是否可以預約與報價，謝謝。`;
  }

  function miniAppBookingUrl() {
    if (!startDate || !endDate) return bookingPageBaseUrl;
    const params = new URLSearchParams({ start: keyOf(startDate), end: keyOf(endDate), source: "website" });
    if (guests) params.set("guests", String(guests));
    return `${bookingPageBaseUrl}?${params.toString()}`;
  }

  function openRangeSheet() {
    if (!startDate || !endDate) return;
    const nights = nightsBetween(startDate,endDate); selectedMessage = buildMessage();
    if (dateSheetTitle) dateSheetTitle.textContent = `${keyOf(startDate)} → ${keyOf(endDate)}`;
    if (dateSheetHint) {
      dateSheetHint.textContent = `共 ${nights} 晚｜入住 15:00 起｜退房 12:00 前。前往 LINE 後會自動帶入日期與人數，再由俐姐確認報價。`;
    }
    if (dateSheetLine) { dateSheetLine.href = miniAppBookingUrl(); dateSheetLine.removeAttribute("target"); }
    dateSheet?.classList.add("open"); dateSheetBackdrop?.classList.add("open"); dateSheet?.setAttribute("aria-hidden", "false"); dateSheetBackdrop?.setAttribute("aria-hidden", "false");
  }

  function syncInputs(){
    if(checkInInput) checkInInput.value=startDate?keyOf(startDate):"";
    if(checkOutInput) checkOutInput.value=endDate?keyOf(endDate):"";
    if(guestsSelect) guestsSelect.value=guests||"";
    const min=keyOf(today),max=keyOf(maxBookableDate());
    if(checkInInput){checkInInput.min=min;checkInInput.max=max;}
    if(checkOutInput){checkOutInput.min=startDate?keyOf(new Date(startDate.getFullYear(),startDate.getMonth(),startDate.getDate()+1)):min;checkOutInput.max=max;}
  }

  function renderWebsiteQuote(){
    const form=document.querySelector("#websiteBookingForm");
    if(!endDate){
      websiteBookingDetail?.classList.add("hidden-v656");
      form?.classList.add("hidden-v656");
      if(selectedNights)selectedNights.textContent="—";
      return;
    }
    const nights=nightsBetween(startDate,endDate);
    if(selectedNights)selectedNights.textContent=`${nights} 晚`;
    websiteBookingDetail?.classList.remove("hidden-v656");
    form?.classList.remove("hidden-v656");
    if(websiteBookingPriceLines){
      websiteBookingPriceLines.replaceChildren();
      const details=Array.isArray(selectedQuote?.details)?selectedQuote.details:[];
      if(details.length){
        for(const d of details){
          const row=document.createElement("div"); row.className="booking-price-line";
          const left=document.createElement("span"); left.textContent=`${d.date}｜${d.label||"住宿"}`;
          const right=document.createElement("strong"); right.textContent=`NT$ ${money.format(Number(d.price)||0)}`;
          row.append(left,right); websiteBookingPriceLines.append(row);
        }
      }else{
        const row=document.createElement("div"); row.className="booking-price-line"; row.innerHTML="<span>價格正在確認</span><strong>請稍候</strong>"; websiteBookingPriceLines.append(row);
      }
    }
    if(websiteBookingTotal)websiteBookingTotal.textContent=selectedQuote?.total!=null?`NT$ ${money.format(Number(selectedQuote.total)||0)}`:"價格確認中";
  }

  function updateSelectionUI() {
    syncInputs(); saveWebsiteDraft();
    if (!startDate) { selectedCard?.classList.add("hidden"); return; }
    selectedCard?.classList.remove("hidden"); if (selectedText) selectedText.textContent = rangeLabel();
    if(selectedCheckIn) selectedCheckIn.textContent=startDate?keyOf(startDate):"—";
    if(selectedCheckOut) selectedCheckOut.textContent=endDate?keyOf(endDate):"—";
    if(selectedGuests) selectedGuests.textContent=guests?`${guests} 人`:"請選擇";
    renderWebsiteQuote();
    if (selectedLine) { selectedLine.href = endDate ? miniAppBookingUrl() : "#"; selectedLine.textContent = endDate ? "官方 LINE 預約日曆" : "再選擇退房日期"; selectedLine.removeAttribute("target"); }
  }

  async function selectDate(d) {
    if(isBeyondWindow(d)){ statusNode.textContent=`目前僅開放未來 ${pricingSettings.bookingWindowMonths||6} 個月預約。`; return; }
    if (!startDate || endDate || d <= startDate) {
      startDate = new Date(d); endDate = null; selectedQuote=null;
      statusNode.textContent = "已選入住日，請再點選退房日期。"; updateSelectionUI(); await render(false); return;
    }
    endDate = new Date(d); statusNode.textContent = "正在確認住宿期間…"; updateSelectionUI(); await render(false);
    try {
      if(isBeyondWindow(endDate)){ endDate=null; statusNode.textContent=`退房日期需在未來 ${pricingSettings.bookingWindowMonths||6} 個月內。`; updateSelectionUI(); await render(false); return; }
      const [check,quote]=await Promise.all([rangeIsAvailable(startDate,endDate),quoteRange(startDate,endDate)]);
      if (!check.ok) { const blockedDate = fullFormatter.format(check.date); endDate = null; selectedQuote=null; statusNode.textContent = `${blockedDate} 已不可預約，請重新選擇退房日期。`; updateSelectionUI(); await render(false); return; }
      selectedQuote=quote; const nights = nightsBetween(startDate,endDate);
      statusNode.textContent = `已選 ${nights} 晚。`;
      updateSelectionUI(); openRangeSheet();
    } catch (error) { console.warn("Range availability unavailable", error); statusNode.textContent = "目前無法完整驗證日期，請透過官方 LINE 再確認。"; openRangeSheet(); }
  }

  async function render(showLoading = true) {
    const seq=++renderSeq;
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
    monthLabel.textContent = formatter.format(first);
    if (showLoading) { calendarCard?.classList.add("is-loading"); statusNode.textContent = startDate && !endDate ? "請選擇退房日期。" : "正在載入可預約日期…"; }

    // Render current-month skeleton immediately. Adjacent month dates are never rendered.
    grid.replaceChildren();
    for(let i=0;i<first.getDay();i++){const ph=document.createElement("span");ph.className="calendar-placeholder";ph.setAttribute("aria-hidden","true");grid.append(ph);}

    let states = new Map(), prices = new Map();
    try {
      [states, prices] = await Promise.all([getMonthStates(first,last), getMonthPricing(first)]);
      if(seq!==renderSeq) return;
      if (showLoading) statusNode.textContent = startDate && !endDate ? "已選入住日，請再點選退房日期。" : `先選入住日，再選退房日｜開放未來 ${pricingSettings.bookingWindowMonths||6} 個月。`;
    } catch (error) {
      if(seq!==renderSeq) return;
      console.warn("Calendar unavailable", error);
      if (showLoading) statusNode.textContent = "目前無法同步最新日期，請直接透過 LINE 詢問。";
    }

    if(seq!==renderSeq) return;
    const max=maxBookableDate();
    if(prevBtn) prevBtn.disabled = cursor.getFullYear()===today.getFullYear() && cursor.getMonth()===today.getMonth();
    if(nextBtn){ const nextMonth=new Date(cursor.getFullYear(),cursor.getMonth()+1,1); nextBtn.disabled=nextMonth>new Date(max.getFullYear(),max.getMonth(),1); }
    grid.replaceChildren();
    for(let i=0;i<first.getDay();i++){const ph=document.createElement("span");ph.className="calendar-placeholder";ph.setAttribute("aria-hidden","true");grid.append(ph);}
    for(let day=1;day<=last.getDate();day++){
      const d=new Date(cursor.getFullYear(),cursor.getMonth(),day); const key=keyOf(d); const state=states.get(key)||"available"; const rate=prices.get(key);
      const past=d<today,beyond=isBeyondWindow(d);
      const btn=document.createElement("button");btn.type="button";btn.className=`calendar-day ${past?"past":""} ${beyond?"future-locked":""} ${state}`.trim();
      if(key===keyOf(today))btn.classList.add("today");if(isSameDay(d,startDate))btn.classList.add("range-start","selected");if(isSameDay(d,endDate))btn.classList.add("range-end","selected");if(isWithinRange(d))btn.classList.add("in-range");
      const labels={available:"可預約",booked:"已預約",blocked:"暫停"};
      const selectionLabel=isSameDay(d,startDate)?"入住":isSameDay(d,endDate)?"退房":isWithinRange(d)?"住宿":beyond?"尚未開放":(labels[state]||"可預約");
      const priceText="";
      const tag=!past&&!beyond&&state==="available"&&rate?.label&&!['平日','週五','週六','週五／週六'].includes(rate.label)?`<span class="rate-tag">${shortTag(rate.label)}</span>`:"";
      btn.innerHTML=`<span class="day-number">${day}</span>${priceText}${tag}<span class="state">${selectionLabel}</span>`;
      btn.setAttribute("aria-label",`${fullFormatter.format(d)}，${selectionLabel}${rate?.label?`，${rate.label}`:''}`);
      const canBeCheckout=!!startDate&&!endDate&&d>startDate&&!beyond;btn.disabled=past||beyond||(!canBeCheckout&&state!=="available");
      if(!btn.disabled)btn.addEventListener("click",()=>selectDate(d));grid.append(btn);
    }
    calendarCard?.classList.remove("is-loading");
    // Warm next/previous month caches after current render, making arrows feel instant.
    window.requestIdleCallback?.(()=>{
      const candidates=[new Date(cursor.getFullYear(),cursor.getMonth()+1,1),new Date(cursor.getFullYear(),cursor.getMonth()-1,1)];
      for(const m of candidates){if(m<new Date(today.getFullYear(),today.getMonth(),1)||m>new Date(max.getFullYear(),max.getMonth(),1))continue;const l=new Date(m.getFullYear(),m.getMonth()+1,0);getMonthStates(m,l).catch(()=>{});getMonthPricing(m).catch(()=>{});}
    },{timeout:800});
  }

  prevBtn?.addEventListener("click", () => { if(prevBtn.disabled) return; cursor = new Date(cursor.getFullYear(), cursor.getMonth()-1, 1); render(); });
  nextBtn?.addEventListener("click", () => { if(nextBtn.disabled) return; cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1); render(); });
  document.querySelector("#dateSheetClose")?.addEventListener("click", closeDateSheet); dateSheetBackdrop?.addEventListener("click", closeDateSheet);
  document.querySelector("#dateSheetCalendar")?.addEventListener("click", () => { closeDateSheet(); document.querySelector("#booking")?.scrollIntoView({ behavior: "smooth", block: "center" }); });
  async function applyQuickSelection(){
    const sKey=checkInInput?.value||"", eKey=checkOutInput?.value||""; guests=guestsSelect?.value||guests||"";
    if(!/^\d{4}-\d{2}-\d{2}$/.test(sKey)){statusNode.textContent="請先選擇入住日期。";return;}
    const sDate=localDateFromKey(sKey); if(sDate<today||isBeyondWindow(sDate)){statusNode.textContent="入住日期不在目前開放範圍。";return;}
    startDate=sDate;endDate=null;selectedQuote=null;cursor=new Date(sDate.getFullYear(),sDate.getMonth(),1);
    if(/^\d{4}-\d{2}-\d{2}$/.test(eKey)){const eDate=localDateFromKey(eKey);if(eDate>sDate&&!isBeyondWindow(eDate)){endDate=eDate;const [check,quote]=await Promise.all([rangeIsAvailable(startDate,endDate),quoteRange(startDate,endDate)]);if(!check.ok){endDate=null;selectedQuote=null;statusNode.textContent=`${fullFormatter.format(check.date)} 已不可預約，請重新選擇。`;updateSelectionUI();await render(false);return;}selectedQuote=quote;}}
    updateSelectionUI();await render(false);
    if(endDate){statusNode.textContent=`已帶入 ${nightsBetween(startDate,endDate)} 晚。`;openRangeSheet();}
    else statusNode.textContent="已帶入入住日期，請再選退房日期。";
  }
  applySelectionBtn?.addEventListener("click",applyQuickSelection);
  guestsSelect?.addEventListener("change",()=>{guests=guestsSelect.value;updateSelectionUI();});
  checkInInput?.addEventListener("change",()=>{const k=checkInInput.value;if(/^\d{4}-\d{2}-\d{2}$/.test(k)){const d=localDateFromKey(k);cursor=new Date(d.getFullYear(),d.getMonth(),1);render();}});
  checkOutInput?.addEventListener("change",()=>{if(checkInInput?.value) applyQuickSelection();});
  const websiteTestMode=new URLSearchParams(location.search).get("test")==="1";
  const testBanner=document.querySelector("#bookingTestBanner");
  if(websiteTestMode) testBanner?.classList.add("show");
  const websiteBookingForm=document.querySelector("#websiteBookingForm");
  websiteBookingForm?.addEventListener("submit",async(e)=>{
    e.preventDefault();
    const msg=document.querySelector("#websiteBookingMessage"), btn=document.querySelector("#websiteBookingSubmit");
    const setMsg=(t,c="")=>{if(msg){msg.textContent=t;msg.className=`booking-submit-message ${c}`.trim();}};
    if(!startDate||!endDate){setMsg("請先選好入住與退房日期。","error");return;}
    const name=document.querySelector("#websiteGuestName")?.value.trim()||"", phone=document.querySelector("#websiteGuestPhone")?.value.trim()||"", email=document.querySelector("#websiteGuestEmail")?.value.trim()||"";
    if(!guests){setMsg("請先選擇入住人數。","error");return;}
    if(!name||!email){setMsg("請填寫姓名與 Email。","error");return;}
    if(!selectedQuote||selectedQuote.total==null){setMsg("價格明細尚未完成，請稍候或重新選擇日期。","error");return;}
    btn.disabled=true; setMsg("正在送出預約需求…");
    try{
      const r=await fetch("/api/website-booking-submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({checkIn:keyOf(startDate),checkOut:keyOf(endDate),people:Number(guests||guestsSelect?.value)||1,name,phone,email,testMode:websiteTestMode,companyUrlDoNotFill:document.querySelector("#websiteTrap")?.value||""})});
      const data=await r.json().catch(()=>({})); if(!r.ok||!data.ok||!data.bookingId) throw new Error(data.error||"BOOKING_ID_MISSING");
      setMsg(`${data.isTest?"【測試訂單】\n":""}預約申請已送出 ✓\n\n預約編號：${data.bookingId}\n目前狀態：等待訂金入帳\n固定訂金：NT$3,000\n\n付款資訊\n高雄市鳥松區農會\n農分會代號：619-1089\n戶名：吳俐潔 小姐\n帳號：01089210623310\n\n訂金確認入帳後，民宿才會正式確認預約。\n\n若想在官方 LINE 查詢這筆訂單，只要在官方 LINE 輸入預約編號「${data.bookingId}」即可綁定；一筆訂單最多綁定一位 LINE 使用者。`,"success");
      btn.textContent="已送出預約需求";
    }catch(err){
      const code=String(err?.message||"");
      const map={
        INVALID_DATES:"入住／退房日期不正確，請重新選擇日期。",
        NAME_REQUIRED:"請填寫預約姓名。",
        EMAIL_REQUIRED:"Email 格式不正確，請確認後再送出。",
        FIRESTORE_NOT_CONFIGURED:"目前預約系統尚未完成 Firebase 設定。",
        BOOKING_OUTSIDE_WINDOW:"所選日期目前不在開放預約範圍內。",
        FORM_REJECTED:"安全檢查未通過，請重新整理頁面後再試。"
      };
      let friendly=map[code]||"送出失敗，請稍後再試。";
      if(code.startsWith("FIRESTORE_BOOKING_SAVE_FAILED")) friendly="預約資料暫時無法寫入，請稍後再試。";
      setMsg(websiteTestMode?`${friendly}\n\n測試錯誤代碼：${code}`:friendly,"error");
      btn.disabled=false;
    }
  });

  selectedLine?.addEventListener("click", (e) => { if (!endDate) e.preventDefault(); });
  dateSheetCopy?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(selectedMessage); dateSheetCopy.textContent = "已複製，可貼到 LINE ✓"; setTimeout(() => dateSheetCopy.textContent = "複製預約內容", 1800); } catch { dateSheetCopy.textContent = selectedMessage; } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDateSheet(); });
  window.addEventListener("pageshow", () => { render(false); });
  loadWebsiteDraft(); updateSelectionUI(); render();
}
