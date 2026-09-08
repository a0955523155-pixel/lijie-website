import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./config.js";

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node && typeof value === "string") node.textContent = value;
}

function setHref(selector, value) {
  if (!value || !/^https:\/\//i.test(value)) return;
  document.querySelectorAll(selector).forEach((node) => { node.href = value; });
}

function safeImageUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value, location.href);
    return ["https:", "http:"].includes(url.protocol) ? url.href.replaceAll('"', "%22") : "";
  } catch { return ""; }
}

function applyContent(content) {
  if (!content) return;
  setText(".hero .eyebrow", content.hero?.eyebrow);
  const heroTitle = document.querySelector(".hero h1");
  if (heroTitle) {
    heroTitle.replaceChildren(
      document.createTextNode(content.hero?.titleLine1 || ""),
      document.createElement("br"),
      document.createTextNode(content.hero?.titleLine2 || "")
    );
  }
  setText(".hero-copy", content.hero?.description);

  const slides = [...document.querySelectorAll(".hero .slide")];
  (content.hero?.images || []).slice(0, slides.length).forEach((image, index) => {
    const url = safeImageUrl(image?.url);
    if (url) slides[index].style.backgroundImage = `url("${url}")`;
  });

  const factValues = [content.details?.capacity, content.details?.schedule, content.details?.parking];
  document.querySelectorAll(".facts .fact strong").forEach((node, index) => {
    if (factValues[index]) node.textContent = factValues[index];
  });
  const publicDetails = {
    capacity: content.details?.capacity,
    schedule: content.details?.schedule,
    hours: content.details?.hours,
    parking: content.details?.parking
  };
  Object.entries(publicDetails).forEach(([key, value]) => {
    const node = document.querySelector(`#details [data-detail="${key}"]`);
    if (node && value) node.textContent = value;
  });

  document.querySelectorAll(".facility img").forEach((node, index) => {
    const image = content.facilities?.[index]?.image;
    const url = safeImageUrl(image?.url);
    if (url) node.src = url;
    if (image?.alt) node.alt = image.alt;
  });

  const roomSlides = [...document.querySelectorAll(".room-slide")];
  roomSlides.forEach((slide, index) => {
    const room = content.rooms?.[index];
    if (!room) { slide.hidden = true; return; }
    slide.hidden = false;
    const img = slide.querySelector(".room-photo img");
    const url = safeImageUrl(room.image?.url);
    if (img && url) img.src = url;
    if (img && room.image?.alt) img.alt = room.image.alt;
    const kicker = slide.querySelector(".room-kicker");
    const title = slide.querySelector(".room-copy h3");
    const description = slide.querySelector(".room-copy p");
    const indexBadge = slide.querySelector(".room-index");
    if (kicker) kicker.textContent = room.kicker || `ROOM ${room.number || String(index + 1).padStart(2, "0")}`;
    if (title) title.textContent = room.alias || `${room.number || String(index + 1).padStart(2, "0")}號${room.name || "房間"}`;
    if (description && room.description) {
      const publicDescription = room.description
        .replace(/房間別名與介紹文字可由後台自行調整。?/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      description.textContent = publicDescription;
    }
    if (indexBadge) indexBadge.textContent = `${room.number || String(index + 1).padStart(2, "0")} / ${String(content.rooms.length).padStart(2, "0")}`;
  });
  document.dispatchEvent(new CustomEvent("lijie:rooms-updated"));

  const usePhoto = document.querySelector(".use-photo");
  const useUrl = safeImageUrl(content.usePhoto?.url);
  if (usePhoto && useUrl) {
    usePhoto.style.backgroundImage = `url("${useUrl}")`;
    usePhoto.setAttribute("aria-label", content.usePhoto.alt || "場地空間");
  }
  const cta = document.querySelector(".cta");
  const ctaUrl = safeImageUrl(content.ctaPhoto?.url);
  if (cta && ctaUrl) cta.style.backgroundImage = `linear-gradient(90deg,rgba(8,27,24,.93),rgba(8,27,24,.72)),url("${ctaUrl}")`;

  setHref('a[href*="line.me"]', content.contact?.lineUrl);
  setHref('a[href*="google.com/maps"]', content.contact?.mapUrl);
  const phone = content.contact?.phone;
  if (phone) document.querySelectorAll('a[href^="tel:"]').forEach((node) => {
    node.textContent = phone;
    node.href = `tel:${phone.replace(/[^0-9+]/g, "")}`;
  });
}

async function loadPublishedContent() {
  if (new URLSearchParams(location.search).get("preview") === "1") {
    try {
      const preview = JSON.parse(sessionStorage.getItem("lijiePreview") || "null");
      if (preview) applyContent(preview);
    } catch (error) { console.warn("Draft preview could not be loaded.", error); }
    return;
  }
  if (!isConfigured()) return;
  try {
    const app = initializeApp(firebaseConfig);
    const snapshot = await getDoc(doc(getFirestore(app), "publishedContent", "home"));
    if (snapshot.exists()) applyContent(snapshot.data().content);
  } catch (error) {
    console.warn("Published content is temporarily unavailable; using bundled content.", error);
  }
}

loadPublishedContent();
