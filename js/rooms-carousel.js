(() => {
  const track = document.getElementById("roomsTrack");
  const viewport = document.getElementById("roomsViewport");
  const dotsHost = document.getElementById("roomDots");
  const counter = document.getElementById("roomCounter");
  const prev = document.getElementById("roomPrev");
  const next = document.getElementById("roomNext");
  if (!track || !viewport || !dotsHost) return;

  let current = 0;
  let startX = null;

  function slides() { return [...track.querySelectorAll(".room-slide")]; }
  function clamp(index) {
    const total = slides().length;
    if (!total) return 0;
    return (index + total) % total;
  }
  function renderDots() {
    const total = slides().length;
    dotsHost.replaceChildren();
    for (let i = 0; i < total; i++) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = `room-dot${i === current ? " active" : ""}`;
      dot.setAttribute("aria-label", `查看第 ${i + 1} 間房`);
      dot.addEventListener("click", () => go(i));
      dotsHost.append(dot);
    }
  }
  function go(index) {
    const total = slides().length;
    if (!total) return;
    current = clamp(index);
    track.style.transform = `translateX(-${current * 100}%)`;
    [...dotsHost.children].forEach((dot, i) => dot.classList.toggle("active", i === current));
    if (counter) counter.textContent = `${String(current + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  }
  function refresh() {
    current = Math.min(current, Math.max(0, slides().length - 1));
    renderDots();
    go(current);
  }

  prev?.addEventListener("click", () => go(current - 1));
  next?.addEventListener("click", () => go(current + 1));
  viewport.addEventListener("touchstart", (e) => { startX = e.changedTouches[0]?.clientX ?? null; }, { passive: true });
  viewport.addEventListener("touchend", (e) => {
    if (startX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? startX;
    const delta = endX - startX;
    startX = null;
    if (Math.abs(delta) < 45) return;
    go(current + (delta < 0 ? 1 : -1));
  }, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (!document.getElementById("rooms")?.matches(":hover")) return;
    if (e.key === "ArrowLeft") go(current - 1);
    if (e.key === "ArrowRight") go(current + 1);
  });
  document.addEventListener("lijie:rooms-updated", refresh);
  refresh();
})();
