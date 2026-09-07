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
  const dateSheetLine = document.querySelector("#dateSheetLine");
  const dateSheetCopy = document.querySelector("#dateSheetCopy");
  const lineBase = selectedLine?.href?.split("?")[0] || "https://line.me/ti/p/~287ppyfa";
  let selectedMessage = "";
  const formatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long" });
  const fullFormatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const today = new Date(); today.setHours(0,0,0,0);
  let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  let selectedKey = "";
  let db = null;
  if (isConfigured()) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    db = getFirestore(app);
  }

  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  async function getMonthStates(first, last) {
    if (!db) return new Map();
    try {
      const q = query(collection(db, "availability"), where(documentId(), ">=", keyOf(first)), where(documentId(), "<=", keyOf(last)));
      const snap = await getDocs(q);
      return new Map(snap.docs.map(d => [d.id, d.data().status || "available"]));
    } catch (error) {
      console.warn("Availability unavailable", error);
      throw error;
    }
  }

  function closeDateSheet() {
    dateSheet?.classList.remove("open");
    dateSheetBackdrop?.classList.remove("open");
    dateSheet?.setAttribute("aria-hidden", "true");
    dateSheetBackdrop?.setAttribute("aria-hidden", "true");
  }

  function openDateSheet(d, key) {
    selectedMessage = `您好，我想詢問俐姐的家 ${key} 是否可以預約？`;
    if (dateSheetTitle) dateSheetTitle.textContent = fullFormatter.format(d);
    if (dateSheetLine) dateSheetLine.href = lineBase;
    dateSheet?.classList.add("open");
    dateSheetBackdrop?.classList.add("open");
    dateSheet?.setAttribute("aria-hidden", "false");
    dateSheetBackdrop?.setAttribute("aria-hidden", "false");
  }

  async function render() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
    monthLabel.textContent = formatter.format(first);
    grid.replaceChildren();
    statusNode.textContent = "正在載入可預約日期…";
    let states = new Map();
    try { states = await getMonthStates(first, last); statusNode.textContent = "點選「可詢問」日期後，可直接帶日期到 LINE 詢問。"; }
    catch { statusNode.textContent = "目前無法同步最新日期，請直接透過 LINE 詢問。"; }

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
      if (key === selectedKey) btn.classList.add("selected");
      const labels = { available:"可詢問", booked:"已預約", blocked:"暫停" };
      btn.innerHTML = `<span>${d.getDate()}</span><span class="state">${labels[state] || "可詢問"}</span>`;
      btn.setAttribute("aria-label", `${fullFormatter.format(d)}，${labels[state] || "可詢問"}`);
      btn.disabled = past || state !== "available";
      if (!btn.disabled) btn.addEventListener("click", () => {
        selectedKey = key;
        selectedText.textContent = fullFormatter.format(d);
        selectedMessage = `您好，我想詢問俐姐的家 ${key} 是否可以預約？`;
        selectedLine.href = lineBase;
        selectedCard.classList.remove("hidden");
        openDateSheet(d, key);
        render();
      });
      grid.append(btn);
    }
  }

  document.querySelector("#calendarPrev")?.addEventListener("click", () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth()-1, 1); render(); });
  document.querySelector("#calendarNext")?.addEventListener("click", () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1); render(); });
  document.querySelector("#dateSheetClose")?.addEventListener("click", closeDateSheet);
  dateSheetBackdrop?.addEventListener("click", closeDateSheet);
  document.querySelector("#dateSheetCalendar")?.addEventListener("click", () => { closeDateSheet(); document.querySelector("#booking")?.scrollIntoView({ behavior: "smooth", block: "center" }); });
  dateSheetCopy?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(selectedMessage); dateSheetCopy.textContent = "已複製，可貼到 LINE ✓"; setTimeout(() => dateSheetCopy.textContent = "複製詢問文字", 1800); }
    catch { dateSheetCopy.textContent = selectedMessage; }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDateSheet(); });
  render();
}
