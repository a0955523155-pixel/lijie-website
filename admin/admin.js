import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";
import { firebaseConfig, isConfigured } from "../js/config.js";
import { DEFAULT_CONTENT } from "../js/default-content.js";

const $ = (selector) => document.querySelector(selector);
const clone = (value) => JSON.parse(JSON.stringify(value));
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
let auth;
let db;
let storage;
let draft = clone(DEFAULT_CONTENT);
let draggedIndex = null;

function message(selector, text, type = "") {
  const node = $(selector);
  node.textContent = text;
  node.className = `message ${type}`.trim();
}

function setPath(target, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  let cursor = target;
  for (const part of parts) cursor = cursor[part] ??= {};
  cursor[last] = value;
}

const getPath = (target, path) => path.split(".").reduce((value, part) => value?.[part], target) ?? "";

function validateHttps(value) {
  if (!value) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function fillForm() {
  document.querySelectorAll("[data-path]").forEach((input) => { input.value = getPath(draft, input.dataset.path); });
}

function imageCard(image, label, options = {}) {
  const card = document.createElement("article");
  card.className = "photo-card";
  card.draggable = Boolean(options.draggable);
  if (Number.isInteger(options.index)) card.dataset.index = String(options.index);

  const img = document.createElement("img");
  img.src = image.url;
  img.alt = image.alt || label;
  const meta = document.createElement("div");
  meta.className = "photo-meta";
  const title = document.createElement("strong");
  title.textContent = label;
  const alt = document.createElement("input");
  alt.type = "text";
  alt.maxLength = 120;
  alt.value = image.alt || "";
  alt.setAttribute("aria-label", `${label}替代文字`);
  alt.addEventListener("change", () => { image.alt = alt.value.trim(); });
  const actions = document.createElement("div");
  actions.className = "photo-actions";
  if (options.draggable) {
    const hint = document.createElement("button");
    hint.type = "button";
    hint.className = "secondary";
    hint.textContent = "拖曳排序";
    hint.title = "也可直接拖曳整張照片";
    actions.append(hint);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = "從草稿移除";
  remove.addEventListener("click", options.onRemove);
  actions.append(remove);
  meta.append(title, alt, actions);
  card.append(img, meta);

  if (options.draggable) {
    card.addEventListener("dragstart", () => { draggedIndex = options.index; card.classList.add("dragging"); });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", async (event) => {
      event.preventDefault();
      const targetIndex = Number(card.dataset.index);
      if (draggedIndex === null || draggedIndex === targetIndex) return;
      const [moved] = draft.hero.images.splice(draggedIndex, 1);
      draft.hero.images.splice(targetIndex, 0, moved);
      draggedIndex = null;
      renderPhotos();
      await saveDraft("照片順序已儲存。");
    });
  }
  return card;
}

function renderPhotos() {
  const grid = $("#photoGrid");
  grid.replaceChildren();
  draft.hero.images.forEach((image, index) => grid.append(imageCard(image, `封面 ${index + 1}${index === 0 ? "（首頁主圖）" : ""}`, {
    draggable: true,
    index,
    onRemove: async () => {
      if (draft.hero.images.length <= 1) return message("#uploadProgress", "首頁至少需要保留一張封面。", "error");
      draft.hero.images.splice(index, 1);
      renderPhotos();
      await saveDraft("照片已從草稿移除；正式發布前官網不受影響。");
    }
  })));
  draft.facilities.forEach((facility) => grid.append(imageCard(facility.image, facility.name, {
    onRemove: () => message("#uploadProgress", "固定區塊請直接上傳新照片覆蓋，避免官網出現空白。", "error")
  })));
  grid.append(imageCard(draft.usePhoto, "中段主照片", { onRemove: () => message("#uploadProgress", "固定區塊請直接上傳新照片覆蓋。", "error") }));
  grid.append(imageCard(draft.ctaPhoto, "頁尾背景", { onRemove: () => message("#uploadProgress", "固定區塊請直接上傳新照片覆蓋。", "error") }));
}

async function saveDraft(successText = "草稿已儲存。") {
  await setDoc(doc(db, "siteContentDrafts", "home"), { content: draft, updatedAt: serverTimestamp() }, { merge: true });
  message("#saveMessage", successText, "success");
  message("#uploadProgress", successText, "success");
}

async function loadDraft() {
  const snapshot = await getDoc(doc(db, "siteContentDrafts", "home"));
  draft = clone(snapshot.exists() ? snapshot.data().content : DEFAULT_CONTENT);
  if (!snapshot.exists()) await saveDraft("初始草稿已建立。");
  fillForm();
  renderPhotos();
  await loadRevisions();
}

async function loadRevisions() {
  const list = $("#revisionList");
  try {
    const snapshot = await getDocs(query(collection(db, "siteRevisions"), orderBy("createdAt", "desc"), limit(10)));
    list.replaceChildren();
    if (snapshot.empty) { list.textContent = "首次發布後，這裡會顯示版本紀錄。"; return; }
    snapshot.docs.forEach((revision, index) => {
      const row = document.createElement("div");
      row.className = "revision-row";
      const info = document.createElement("span");
      const value = revision.data();
      const date = value.createdAt?.toDate?.();
      info.textContent = `${index === 0 ? "目前版本 · " : ""}${date ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(date) : "剛剛"}`;
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "secondary";
      restore.textContent = "載入為草稿";
      restore.addEventListener("click", async () => {
        draft = clone(value.content);
        await saveDraft("舊版本已載入為草稿，確認後可重新發布。");
        fillForm(); renderPhotos();
        message("#publishMessage", "舊版本已載入為草稿，尚未影響官網。", "success");
      });
      row.append(info, restore);
      list.append(row);
    });
  } catch (error) { list.textContent = "版本紀錄暫時無法載入。"; console.warn(error); }
}

async function ensureAdmin(user) {
  const admin = await getDoc(doc(db, "admins", user.uid));
  if (!admin.exists()) {
    await signOut(auth);
    throw new Error("此信箱尚未被授權為網站管理者。");
  }
  $("#accountEmail").textContent = user.email;
  $("#loginView").classList.add("hidden");
  $("#dashboardView").classList.remove("hidden");
  await loadDraft();
}

async function uploadPhotos() {
  const files = [...$("#photoInput").files];
  if (!files.length) return message("#uploadProgress", "請先選擇照片。", "error");
  const target = $("#uploadTarget").value;
  const button = $("#uploadButton");
  button.disabled = true;
  try {
    if (target === "hero" && draft.hero.images.length + files.length > 5) throw new Error("首頁封面最多 5 張；請先移除不需要的照片。");
    for (const file of files) {
      if (!allowedTypes.has(file.type)) throw new Error(`${file.name} 格式不支援。`);
      if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超過 8 MB。`);
      const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const section = target.startsWith("facility") ? "facility" : target;
      const storagePath = `site-images/${section}/${crypto.randomUUID()}.${extension}`;
      message("#uploadProgress", `正在上傳 ${file.name}…`);
      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, file, { contentType: file.type, cacheControl: "public,max-age=31536000,immutable" });
      const image = { url: await getDownloadURL(fileRef), alt: file.name.replace(/\.[^.]+$/, ""), storagePath };
      if (target === "hero") draft.hero.images.push(image);
      else if (target.startsWith("facility-")) draft.facilities[Number(target.split("-")[1])].image = image;
      else draft[target] = image;
    }
    await saveDraft(`${files.length} 張照片已上傳並存入草稿。`);
    $("#photoInput").value = "";
    renderPhotos();
  } catch (error) { message("#uploadProgress", error.message || "照片上傳失敗，請稍後再試。", "error"); }
  finally { button.disabled = false; }
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    message("#loginMessage", "正在驗證…");
    try { await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#password").value); }
    catch { message("#loginMessage", "登入失敗，請確認信箱與密碼。", "error"); }
  });
  $("#logoutButton").addEventListener("click", async () => { await signOut(auth); location.reload(); });
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    ["photos", "copy", "publish"].forEach((name) => $(`#${name}Panel`).classList.toggle("hidden", name !== button.dataset.tab));
  }));
  $("#uploadButton").addEventListener("click", uploadPhotos);
  $("#contentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      document.querySelectorAll("[data-path]").forEach((input) => {
        const value = input.value.trim();
        if (input.type === "url" && !validateHttps(value)) throw new Error("所有網址都必須使用 https:// 開頭。");
        setPath(draft, input.dataset.path, value);
      });
      await saveDraft();
    } catch (error) { message("#saveMessage", error.message, "error"); }
  });
  $("#previewButton").addEventListener("click", () => {
    sessionStorage.setItem("lijiePreview", JSON.stringify(draft));
    $("#previewFrame").src = `../index.html?preview=1&t=${Date.now()}`;
    $("#previewDialog").showModal();
  });
  $("#closePreview").addEventListener("click", () => $("#previewDialog").close());
  $("#restoreButton").addEventListener("click", async () => {
    const snapshot = await getDoc(doc(db, "publishedContent", "home"));
    if (!snapshot.exists()) return message("#publishMessage", "目前還沒有已發布版本。", "error");
    draft = clone(snapshot.data().content);
    await saveDraft("草稿已恢復為目前官網版本。");
    fillForm(); renderPhotos();
    message("#publishMessage", "草稿已恢復，尚未重新發布。", "success");
  });
  $("#publishButton").addEventListener("click", async () => {
    if (!confirm("確定要將目前草稿發布到官網嗎？")) return;
    message("#publishMessage", "正在發布…");
    try {
      await saveDraft();
      const batch = writeBatch(db);
      batch.set(doc(db, "publishedContent", "home"), { content: draft, publishedAt: serverTimestamp() });
      batch.set(doc(collection(db, "siteRevisions")), { slug: "home", content: draft, publishedBy: auth.currentUser.uid, createdAt: serverTimestamp() });
      await batch.commit();
      message("#publishMessage", "發布完成，訪客重新整理後即可看到新版內容。", "success");
      await loadRevisions();
    } catch (error) { message("#publishMessage", error.message || "發布失敗。", "error"); }
  });
}

async function init() {
  if (!isConfigured()) {
    $("#configNotice").classList.remove("hidden");
    $("#loginForm").querySelectorAll("input,button").forEach((node) => { node.disabled = true; });
    return;
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  await setPersistence(auth, browserSessionPersistence);
  bindEvents();
  let handledUid = "";
  onAuthStateChanged(auth, async (user) => {
    if (!user) { handledUid = ""; return; }
    if (user.uid === handledUid) return;
    handledUid = user.uid;
    try { await ensureAdmin(user); }
    catch (error) { message("#loginMessage", error.message, "error"); }
  });
}

init();
