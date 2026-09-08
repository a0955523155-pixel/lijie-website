import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, collection, query, where, documentId, getDocs } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
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
  const officialLineUrl = "https://line.me/R/ti/p/%40287ppyfa";
  const officialLineChatBase = "https://line.me/R/oaMessage/%40287ppyfa/?";
  const formatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long" });
  const fullFormatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const today = new Date(); today.setHours(0,0,0,0);
  let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  let startDate = null;
  let endDate = null;
  let selectedMessage = "";
  let db = null;
  const monthCache = new Map();

  if (isConfigured()) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    db = getFirestore(app);
  }

  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  const nightsBetween = (a,b) => Math.round((new Date(b.getFullYear(),b.getMonth(),b.getDate()) - new Date(a.getFullYear(),a.getMonth(),a.getDate())) / 86400000);

  async function getMonthStates(first, last) {
    const cacheKey = monthKey(first);
    if (monthCache.has(cacheKey)) return monthCache.get(cacheKey);
    if (!db) {
      const empty = new Map(); monthCache.set(cacheKey, empty); return empty;
    }
    const q = query(collection(db, "availability"), where(documentId(), ">=", keyOf(first)), where(documentId(), "<=", keyOf(last)));
    const snap = await getDocs(q);
    const result = new Map(snap.docs.map(d => [d.id, d.data().status || "available"]));
    monthCache.set(cacheKey, result);
    return result;
  }

  async function stateForDate(d) {
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth()+1, 0);
    const states = await getMonthStates(first, last);
    return states.get(keyOf(d)) || "available";
  }

  async function rangeIsAvailable(start, end) {
    // 退房當天可以是下一組客人的入住日，因此只檢查入住日起到退房前一天。
    const d = new Date(start);
    while (d < end) {
      const state = await stateForDate(d);
      if (state !== "available") return { ok:false, date:new Date(d), state };
      d.setDate(d.getDate()+1);
    }
    return { ok:true };
  }

  function isSameDay(a,b){ return !!a && !!b && keyOf(a)===keyOf(b); }
  function isWithinRange(d){ return !!startDate && !!endDate && d > startDate && d < endDate; }

  function closeDateSheet() {
    dateSheet?.classList.remove("open");
    dateSheetBackdrop?.classList.remove("open");
    dateSheet?.setAttribute("aria-hidden", "true");
    dateSheetBackdrop?.setAttribute("aria-hidden", "true");
  }

  function rangeLabel() {
    if (!startDate) return "尚未選擇";
    if (!endDate) return `${fullFormatter.format(startDate)}（入住）`;
    return `${fullFormatter.format(startDate)} 入住 → ${fullFormatter.format(endDate)} 退房`;
  }

  function buildMessage() {
    if (!startDate || !endDate) return "";
    const nights = nightsBetween(startDate,endDate);
    return `您好，我想詢問俐姐的家住宿預約\n入住日期：${keyOf(startDate)}\n退房日期：${keyOf(endDate)}\n住宿晚數：${nights} 晚\n入住時間：15:00 起\n退房時間：12:00 前\n想確認這段日期是否可以預約，謝謝。`;
  }

  function openRangeSheet() {
    if (!startDate || !endDate) return;
    const nights = nightsBetween(startDate,endDate);
    selectedMessage = buildMessage();
    if (dateSheetTitle) dateSheetTitle.textContent = `${keyOf(startDate)} → ${keyOf(endDate)}`;
    if (dateSheetHint) dateSheetHint.textContent = `共 ${nights} 晚｜入住 15:00 起｜退房 12:00 前。可先複製預約內容，再前往官方 LINE。`;
    if (dateSheetLine) {
      dateSheetLine.href = officialLineChatBase + encodeURIComponent(selectedMessage);
      dateSheetLine.removeAttribute("target");
    }
    dateSheet?.classList.add("open");
    dateSheetBackdrop?.classList.add("open");
    dateSheet?.setAttribute("aria-hidden", "false");
    dateSheetBackdrop?.setAttribute("aria-hidden", "false");
  }

  function updateSelectionUI() {
    if (!startDate) {
      selectedCard?.classList.add("hidden");
      return;
    }
    selectedCard?.classList.remove("hidden");
    if (selectedText) selectedText.textContent = rangeLabel();
    if (selectedLine) {
      selectedLine.href = endDate ? (officialLineChatBase + encodeURIComponent(buildMessage())) : "#";
      selectedLine.textContent = endDate ? "前往官方 LINE 預約 →" : "再選擇退房日期";
      selectedLine.removeAttribute("target");
    }
  }

  async function selectDate(d) {
    if (!startDate || endDate || d <= startDate) {
      startDate = new Date(d);
      endDate = null;
      statusNode.textContent = "已選入住日，請再點選退房日期。";
      updateSelectionUI();
      await render(false);
      return;
    }

    // 第二次點擊且晚於入住日 = 退房日
    endDate = new Date(d);
    statusNode.textContent = "正在確認住宿期間是否可預約…";
    updateSelectionUI();
    await render(false);

    try {
      const check = await rangeIsAvailable(startDate,endDate);
      if (!check.ok) {
        const blockedDate = fullFormatter.format(check.date);
        endDate = null;
        statusNode.textContent = `${blockedDate} 已不可預約，請重新選擇退房日期。`;
        updateSelectionUI();
        await render(false);
        return;
      }
      const nights = nightsBetween(startDate,endDate);
      statusNode.textContent = `已選 ${nights} 晚，確認後可前往官方 LINE 預約。`;
      updateSelectionUI();
      openRangeSheet();
    } catch (error) {
      console.warn("Range availability unavailable", error);
      statusNode.textContent = "目前無法完整驗證日期，請透過官方 LINE 再確認。";
      openRangeSheet();
    }
  }

  async function render(showLoading = true) {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
    monthLabel.textContent = formatter.format(first);
    grid.replaceChildren();
    if (showLoading) statusNode.textContent = startDate && !endDate ? "請選擇退房日期。" : "正在載入可預約日期…";
    let states = new Map();
    try {
      states = await getMonthStates(first, last);
      if (showLoading) statusNode.textContent = startDate && !endDate ? "已選入住日，請再點選退房日期。" : "先選入住日，再選退房日。";
    } catch (error) {
      console.warn("Availability unavailable", error);
      if (showLoading) statusNode.textContent = "目前無法同步最新日期，請直接透過 LINE 詢問。";
    }

    const startOffset = first.getDay();
    const start = new Date(first); start.setDate(1 - startOffset);
    for (let i=0; i<42; i++) {
      const d = new Date(start); d.setDate(start.getDate()+i);
      const key = keyOf(d);
      const state = states.get(key) || "available";
      const outside = d.getMonth() !== cursor.getMonth();
      const past = d < today;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `calendar-day ${outside ? "outside" : ""} ${past ? "past" : ""} ${state}`.trim();
      if (key === keyOf(today)) btn.classList.add("today");
      if (isSameDay(d,startDate)) btn.classList.add("range-start","selected");
      if (isSameDay(d,endDate)) btn.classList.add("range-end","selected");
      if (isWithinRange(d)) btn.classList.add("in-range");
      const labels = { available:"可預約", booked:"已預約", blocked:"暫停" };
      const selectionLabel = isSameDay(d,startDate) ? "入住" : isSameDay(d,endDate) ? "退房" : (isWithinRange(d) ? "住宿" : (labels[state] || "可預約"));
      btn.innerHTML = `<span>${d.getDate()}</span><span class="state">${selectionLabel}</span>`;
      btn.setAttribute("aria-label", `${fullFormatter.format(d)}，${selectionLabel}`);
      // 退房日只需晚於入住日；即使退房當天已被另一筆入住占用，也可作為本筆退房日。
      const canBeCheckout = !!startDate && !endDate && d > startDate;
      btn.disabled = past || (!canBeCheckout && state !== "available");
      if (!btn.disabled) btn.addEventListener("click", () => selectDate(d));
      grid.append(btn);
    }
  }

  document.querySelector("#calendarPrev")?.addEventListener("click", () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth()-1, 1); render(); });
  document.querySelector("#calendarNext")?.addEventListener("click", () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1); render(); });
  document.querySelector("#dateSheetClose")?.addEventListener("click", closeDateSheet);
  dateSheetBackdrop?.addEventListener("click", closeDateSheet);
  document.querySelector("#dateSheetCalendar")?.addEventListener("click", () => { closeDateSheet(); document.querySelector("#booking")?.scrollIntoView({ behavior: "smooth", block: "center" }); });
  selectedLine?.addEventListener("click", (e) => { if (!endDate) e.preventDefault(); });
  dateSheetCopy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(selectedMessage);
      dateSheetCopy.textContent = "已複製，可貼到 LINE ✓";
      setTimeout(() => dateSheetCopy.textContent = "複製預約內容", 1800);
    } catch {
      dateSheetCopy.textContent = selectedMessage;
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDateSheet(); });
  updateSelectionUI();
  render();
}
