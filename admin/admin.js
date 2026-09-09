import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, documentId, orderBy, limit, getDocs, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
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
let selectedFiles = [];
let previewUrls = [];
let adminCalendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let adminSelectedDate = "";
let adminSelectedBookingId = "";
let adminPaymentRecords = [];
let adminMonthStates = new Map();
let libraryAssets = [];
let libraryPickerTarget = null;
let pricingSpecialRanges = [];

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

function ensureDraftShape() {
  draft.hero ??= clone(DEFAULT_CONTENT.hero);
  draft.facilities ??= clone(DEFAULT_CONTENT.facilities);
  const currentRooms = Array.isArray(draft.rooms) ? draft.rooms : [];
  draft.rooms = DEFAULT_CONTENT.rooms.map((fallback, index) => {
    const current = currentRooms[index] || {};
    const merged = { ...clone(fallback), ...current, image: { ...clone(fallback.image), ...(current.image || {}) } };
    // V6.1 migration: the property has exactly four double rooms and one quad room.
    if (!current.number) merged.number = fallback.number;
    merged.name = fallback.name;
    if (!current.alias || ["三人房","家庭房","標準房 A","標準房 B","多人房"].includes(current.name)) merged.alias = fallback.alias;
    if (!current.kicker || ["TRIPLE ROOM","FAMILY ROOM","STANDARD ROOM A","STANDARD ROOM B","GROUP ROOM"].includes(current.kicker)) merged.kicker = fallback.kicker;
    return merged;
  });
  draft._mediaLibrary ??= [];
}

function validateHttps(value) {
  if (!value) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function fillForm() {
  document.querySelectorAll("[data-path]").forEach((input) => { input.value = getPath(draft, input.dataset.path); });
}

function syncContentFormToDraft() {
  document.querySelectorAll("[data-path]").forEach((input) => {
    const value = input.value.trim();
    if (input.type === "url" && !validateHttps(value)) throw new Error("所有網址都必須使用 https:// 開頭。");
    setPath(draft, input.dataset.path, value);
  });
}


function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clearPreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
}

function renderSelectionPreview() {
  const panel = $("#selectionPreview");
  const grid = $("#selectionGrid");
  clearPreviewUrls();
  grid.replaceChildren();

  if (!selectedFiles.length) {
    panel.classList.add("hidden");
    $("#selectionCount").textContent = "已選擇 0 張";
    return;
  }

  panel.classList.remove("hidden");
  $("#selectionCount").textContent = `已選擇 ${selectedFiles.length} 張`;
  selectedFiles.forEach((file, index) => {
    const card = document.createElement("article");
    card.className = "selection-card";
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    img.src = url;
    img.alt = file.name;

    const info = document.createElement("div");
    info.className = "selection-info";
    const name = document.createElement("strong");
    name.className = "selection-name";
    name.textContent = file.name;
    name.title = file.name;
    const size = document.createElement("span");
    size.className = "selection-size";
    size.textContent = formatBytes(file.size);
    info.append(name, size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "selection-remove";
    remove.textContent = "×";
    remove.title = `移除 ${file.name}`;
    remove.setAttribute("aria-label", `移除 ${file.name}`);
    remove.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      renderSelectionPreview();
      message("#uploadProgress", selectedFiles.length ? `目前保留 ${selectedFiles.length} 張，確認後再上傳。` : "已清除選取照片。");
    });
    card.append(img, info, remove);
    grid.append(card);
  });
}

function clearSelectedFiles() {
  selectedFiles = [];
  $("#photoInput").value = "";
  renderSelectionPreview();
}


function libraryImage(asset) {
  return { url: asset.url, alt: (asset.fileName || "網站照片").replace(/\.[^.]+$/, ""), storagePath: asset.storagePath || "" };
}

async function registerLibraryAsset({ url, storagePath, file }) {
  const asset = {
    id: crypto.randomUUID(),
    url,
    storagePath,
    fileName: file.name,
    category: $("#libraryUploadCategory")?.value || "其他",
    size: file.size,
    contentType: file.type,
    createdBy: auth.currentUser.uid,
    createdAt: new Date().toISOString()
  };
  draft._mediaLibrary ??= [];
  draft._mediaLibrary.unshift(asset);
  libraryAssets = draft._mediaLibrary;
  await saveDraft("照片已加入素材庫。", { quietLibrary: true });
  return asset.id;
}

async function loadLibrary() {
  // V5.2 compatibility mode: keep the media index inside the already-authorized
  // siteContentDrafts/home document. This avoids requiring a new imageLibrary
  // Firestore collection/rule deployment just to browse the library.
  draft._mediaLibrary ??= [];
  libraryAssets = draft._mediaLibrary;
  renderLibrary();
}

function filteredLibrary(term = "") {
  const q = term.trim().toLowerCase();
  if (!q) return libraryAssets;
  return libraryAssets.filter(a => `${a.fileName || ""} ${a.category || ""}`.toLowerCase().includes(q));
}

function makeLibraryCard(asset, picker = false) {
  const card = document.createElement("article");
  card.className = "library-card";
  const img = document.createElement("img");
  img.src = asset.url;
  img.alt = asset.fileName || "素材庫照片";
  img.loading = "lazy";
  const body = document.createElement("div");
  body.className = "library-card-body";
  const name = document.createElement("strong");
  name.className = "library-card-name";
  name.textContent = asset.fileName || "未命名照片";
  name.title = asset.fileName || "";
  const meta = document.createElement("div");
  meta.className = "library-card-meta";
  const date = asset.createdAt?.toDate?.() || (asset.createdAt ? new Date(asset.createdAt) : null);
  const validDate = date && !Number.isNaN(date.getTime());
  meta.textContent = `${asset.category || "其他"} · ${asset.size ? formatBytes(asset.size) : ""}${validDate ? ` · ${new Intl.DateTimeFormat("zh-TW", {month:"numeric",day:"numeric"}).format(date)}` : ""}`;
  body.append(name, meta);
  if (picker) {
    const actions = document.createElement("div"); actions.className = "library-card-actions";
    const choose = document.createElement("button"); choose.type="button"; choose.className="primary"; choose.textContent="選這張";
    choose.addEventListener("click", (e) => { e.stopPropagation(); applyLibraryAsset(asset); });
    actions.append(choose); body.append(actions);
    card.addEventListener("dblclick", () => applyLibraryAsset(asset));
  } else {
    const actions = document.createElement("div"); actions.className = "library-card-actions";
    const use = document.createElement("button"); use.type="button"; use.className="secondary"; use.textContent="套用到網站";
    use.addEventListener("click", () => openLibraryPicker({type:"choose-target", asset}));
    const remove = document.createElement("button"); remove.type="button"; remove.className="danger"; remove.textContent="移出素材庫";
    remove.addEventListener("click", async () => {
      if (!confirm(`確定將「${asset.fileName || "這張照片"}」移出素材庫嗎？網站目前使用中的圖片不會被刪除。`)) return;
      draft._mediaLibrary = (draft._mediaLibrary || []).filter(x => x.id !== asset.id);
      libraryAssets = draft._mediaLibrary;
      await saveDraft("素材庫已更新。", { quietLibrary: true });
      renderLibrary();
      message("#libraryMessage","已移出素材庫；實際圖片檔保留，避免影響已發布網站。","success");
    });
    actions.append(use,remove); body.append(actions);
  }
  card.append(img,body);
  return card;
}

function renderLibrary() {
  const grid = $("#libraryGrid");
  if (!grid) return;
  grid.replaceChildren();
  const assets = filteredLibrary($("#librarySearch")?.value || "");
  if (!assets.length) { const e=document.createElement("div"); e.className="library-empty"; e.textContent="素材庫目前沒有符合的照片。先從上方一次上傳常用照片。"; grid.append(e); return; }
  assets.forEach(a => grid.append(makeLibraryCard(a,false)));
}

function renderPickerLibrary() {
  const grid=$("#pickerGrid"); if(!grid) return; grid.replaceChildren();
  const assets=filteredLibrary($("#pickerSearch")?.value || "");
  if(!assets.length){const e=document.createElement("div");e.className="library-empty";e.textContent="找不到符合的素材。";grid.append(e);return;}
  assets.forEach(a=>grid.append(makeLibraryCard(a,true)));
}

function targetLabel(target) {
  if (!target) return "網站照片";
  if (target.type === "hero-add") return "新增首頁封面";
  if (target.type === "hero-replace") return `更換封面 ${target.index + 1}`;
  if (target.type === "facility") return `更換 ${draft.facilities[target.index]?.name || "空間照片"}`;
  if (target.type === "room") return `更換 ${draft.rooms?.[target.index]?.name || `房間 ${target.index + 1}`}`;
  if (target.type === "usePhoto") return "更換中段主照片";
  if (target.type === "ctaPhoto") return "更換頁尾背景";
  return "選擇套用位置";
}

function openLibraryPicker(target) {
  if (target?.type === "choose-target") {
    const asset = target.asset;
    const choices = ["新增首頁封面", ...draft.hero.images.map((_,i)=>`替換封面 ${i+1}`), ...draft.facilities.map(f=>`更換 ${f.name}`), ...draft.rooms.map((r,i)=>`更換 ${r.name || `房間 ${i+1}`}`), "更換中段主照片", "更換頁尾背景"];
    const answer = prompt(`要把「${asset.fileName}」套用到哪裡？\n\n${choices.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\n請輸入編號：`);
    const n=Number(answer); if(!Number.isInteger(n)||n<1||n>choices.length) return;
    if(n===1) libraryPickerTarget={type:"hero-add"};
    else if(n<=1+draft.hero.images.length) libraryPickerTarget={type:"hero-replace",index:n-2};
    else if(n<=1+draft.hero.images.length+draft.facilities.length) libraryPickerTarget={type:"facility",index:n-2-draft.hero.images.length};
    else if(n<=1+draft.hero.images.length+draft.facilities.length+draft.rooms.length) libraryPickerTarget={type:"room",index:n-2-draft.hero.images.length-draft.facilities.length};
    else if(n===2+draft.hero.images.length+draft.facilities.length+draft.rooms.length) libraryPickerTarget={type:"usePhoto"};
    else libraryPickerTarget={type:"ctaPhoto"};
    applyLibraryAsset(asset); return;
  }
  libraryPickerTarget = target;
  $("#libraryPickerTitle").textContent = targetLabel(target);
  $("#pickerHint").textContent = "點「選這張」即可套用到草稿；正式發布前不會影響官網。";
  $("#pickerSearch").value = "";
  renderPickerLibrary();
  $("#libraryPickerDialog").showModal();
}

async function applyLibraryAsset(asset) {
  const target=libraryPickerTarget; if(!target) return;
  const image=libraryImage(asset);
  if(target.type==="hero-add") {
    if(draft.hero.images.length>=5) return message("#uploadProgress","首頁封面最多 5 張。","error");
    draft.hero.images.push(image);
  } else if(target.type==="hero-replace") draft.hero.images[target.index]=image;
  else if(target.type==="facility") draft.facilities[target.index].image=image;
  else if(target.type==="room") draft.rooms[target.index].image=image;
  else if(target.type==="usePhoto") draft.usePhoto=image;
  else if(target.type==="ctaPhoto") draft.ctaPhoto=image;
  await saveDraft(`已從素材庫套用「${asset.fileName || "照片"}」到草稿。`);
  renderPhotos();
  if($("#libraryPickerDialog")?.open) $("#libraryPickerDialog").close();
}

async function uploadFilesToLibrary(files) {
  if (!files.length) return message("#libraryMessage","請先選擇照片。","error");
  const button=$("#libraryUploadButton"); button.disabled=true;
  try {
    let done=0;
    for(const file of files){
      if(!allowedTypes.has(file.type)) throw new Error(`${file.name} 格式不支援。`);
      if(file.size>8*1024*1024) throw new Error(`${file.name} 超過 8 MB。`);
      const extension=file.type==="image/jpeg"?"jpg":file.type.split("/")[1];
      const storagePath=`site-images/library/${crypto.randomUUID()}.${extension}`;
      message("#libraryMessage",`正在上傳 ${file.name}（${done+1}/${files.length}）…`);
      const fileRef=ref(storage,storagePath);
      await uploadBytes(fileRef,file,{contentType:file.type,cacheControl:"public,max-age=31536000,immutable"});
      const url=await getDownloadURL(fileRef);
      await registerLibraryAsset({url,storagePath,file});
      done++;
    }
    $("#libraryInput").value="";
    message("#libraryMessage",`${done} 張照片已加入素材庫。之後換圖可直接挑選。`,"success");
    await loadLibrary();
  } catch(error){message("#libraryMessage",error.message||"素材庫上傳失敗。","error");}
  finally{button.disabled=false;}
}

async function uploadLocalReplacement(file, target) {
  if(!allowedTypes.has(file.type)) return message("#uploadProgress",`${file.name} 格式不支援。`,"error");
  if(file.size>8*1024*1024) return message("#uploadProgress",`${file.name} 超過 8 MB。`,"error");
  try{
    const extension=file.type==="image/jpeg"?"jpg":file.type.split("/")[1];
    const storagePath=`site-images/library/${crypto.randomUUID()}.${extension}`;
    message("#uploadProgress",`正在上傳 ${file.name}…`);
    const fileRef=ref(storage,storagePath);
    await uploadBytes(fileRef,file,{contentType:file.type,cacheControl:"public,max-age=31536000,immutable"});
    const url=await getDownloadURL(fileRef);
    await registerLibraryAsset({url,storagePath,file});
    const image={url,alt:file.name.replace(/\.[^.]+$/,""),storagePath};
    if(target.type==="hero-replace") draft.hero.images[target.index]=image;
    else if(target.type==="facility") draft.facilities[target.index].image=image;
    else if(target.type==="room") draft.rooms[target.index].image=image;
    else if(target.type==="usePhoto") draft.usePhoto=image;
    else if(target.type==="ctaPhoto") draft.ctaPhoto=image;
    await saveDraft("新照片已上傳、加入素材庫並套用到草稿。");
    renderPhotos(); await loadLibrary();
  }catch(error){message("#uploadProgress",error.message||"照片上傳失敗。","error");}
}

function imageCard(image, label, options = {}) {
  const card = document.createElement("article");
  card.className = "photo-card";
  card.draggable = Boolean(options.draggable);
  if (Number.isInteger(options.index)) card.dataset.index = String(options.index);

  const img = document.createElement("img");
  img.src = image.url;
  img.alt = image.alt || label;
  img.title = "點圖片從素材庫更換";
  if (options.target) img.addEventListener("click", () => openLibraryPicker(options.target));
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
  const hintText = document.createElement("p");
  hintText.className = "photo-change-hint";
  hintText.textContent = "點照片可從素材庫更換";
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
  if (options.target) {
    const choose = document.createElement("button");
    choose.type = "button"; choose.className = "choose-library"; choose.textContent = "從素材庫更換";
    choose.addEventListener("click", () => openLibraryPicker(options.target));
    const localId = `local-${crypto.randomUUID()}`;
    const localLabel = document.createElement("label"); localLabel.className = "photo-local-label"; localLabel.htmlFor = localId; localLabel.textContent = "從本機更換";
    const localInput = document.createElement("input"); localInput.id=localId; localInput.className="photo-local-input"; localInput.type="file"; localInput.accept="image/jpeg,image/png,image/webp";
    localInput.addEventListener("change", () => { const file=localInput.files?.[0]; if(file) uploadLocalReplacement(file, options.target); });
    actions.append(choose, localLabel, localInput);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = "從草稿移除";
  remove.addEventListener("click", options.onRemove);
  actions.append(remove);
  meta.append(title, alt, hintText, actions);
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
    target: { type: "hero-replace", index },
    onRemove: async () => {
      if (draft.hero.images.length <= 1) return message("#uploadProgress", "首頁至少需要保留一張封面。", "error");
      draft.hero.images.splice(index, 1);
      renderPhotos();
      await saveDraft("照片已從草稿移除；正式發布前官網不受影響。");
    }
  })));
  draft.facilities.forEach((facility, index) => grid.append(imageCard(facility.image, facility.name, {
    target: { type: "facility", index },
    onRemove: () => message("#uploadProgress", "固定區塊請直接上傳新照片覆蓋，避免官網出現空白。", "error")
  })));
  draft.rooms.forEach((room, index) => grid.append(imageCard(room.image, `房間輪播 ${index + 1}｜${room.name || "未命名房間"}`, {
    target: { type: "room", index },
    onRemove: () => message("#uploadProgress", "房間輪播請直接更換照片，避免前台輪播出現空白。", "error")
  })));
  grid.append(imageCard(draft.usePhoto, "中段主照片", { target: { type: "usePhoto" }, onRemove: () => message("#uploadProgress", "固定區塊請直接上傳新照片覆蓋。", "error") }));
  grid.append(imageCard(draft.ctaPhoto, "頁尾背景", { target: { type: "ctaPhoto" }, onRemove: () => message("#uploadProgress", "固定區塊請直接上傳新照片覆蓋。", "error") }));
}

async function saveDraft(successText = "草稿已儲存。", options = {}) {
  await setDoc(doc(db, "siteContentDrafts", "home"), { content: draft, updatedAt: serverTimestamp() }, { merge: true });
  message("#saveMessage", successText, "success");
  message("#uploadProgress", successText, "success");
  if (!options.quietLibrary && $("#libraryMessage")) message("#libraryMessage", successText, "success");
}

function publicContentFromDraft() {
  const value = clone(draft);
  delete value._mediaLibrary;
  return value;
}

async function loadDraft() {
  const snapshot = await getDoc(doc(db, "siteContentDrafts", "home"));
  draft = clone(snapshot.exists() ? snapshot.data().content : DEFAULT_CONTENT);
  ensureDraftShape();
  if (!snapshot.exists()) await saveDraft("初始草稿已建立。");
  fillForm();
  renderPhotos();
  await loadRevisions();
  await loadLibrary();
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
        const currentLibrary = clone(draft._mediaLibrary || []);
        draft = clone(value.content);
        ensureDraftShape();
        draft._mediaLibrary = currentLibrary;
        libraryAssets = draft._mediaLibrary;
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
  clearBookingEditor();
  setOperationsDefaultDates();
  if(document.querySelector('.tab[data-tab="operations"]')?.classList.contains("active")) await loadOperations();
}

async function uploadPhotos() {
  const files = [...selectedFiles];
  if (!files.length) return message("#uploadProgress", "請先選擇照片。", "error");
  const target = $("#uploadTarget").value;
  const button = $("#uploadButton");
  button.disabled = true;
  try {
    if (target === "hero" && draft.hero.images.length + files.length > 5) throw new Error(`首頁封面最多 5 張，目前還可新增 ${Math.max(0, 5 - draft.hero.images.length)} 張。請在上方縮圖移除多餘照片。`);
    if (target !== "hero" && files.length > 1) throw new Error("這個照片位置一次只能放 1 張。請先看縮圖，再移除到只剩要使用的那張。");
    for (const file of files) {
      if (!allowedTypes.has(file.type)) throw new Error(`${file.name} 格式不支援。`);
      if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超過 8 MB。`);
      const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const section = target.startsWith("facility") ? "facility" : target.startsWith("room-") ? "room" : target;
      const storagePath = `site-images/${section}/${crypto.randomUUID()}.${extension}`;
      message("#uploadProgress", `正在上傳 ${file.name}…`);
      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, file, { contentType: file.type, cacheControl: "public,max-age=31536000,immutable" });
      const url = await getDownloadURL(fileRef);
      await registerLibraryAsset({ url, storagePath, file });
      const image = { url, alt: file.name.replace(/\.[^.]+$/, ""), storagePath };
      if (target === "hero") draft.hero.images.push(image);
      else if (target.startsWith("facility-")) draft.facilities[Number(target.split("-")[1])].image = image;
      else if (target.startsWith("room-")) draft.rooms[Number(target.split("-")[1])].image = image;
      else draft[target] = image;
    }
    await saveDraft(`${files.length} 張照片已上傳並存入草稿。`);
    clearSelectedFiles();
    renderPhotos();
    await loadLibrary();
  } catch (error) { message("#uploadProgress", error.message || "照片上傳失敗，請稍後再試。", "error"); }
  finally { button.disabled = false; }
}


function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function localDateFromKey(key) { const [y,m,d] = key.split("-").map(Number); return new Date(y,m-1,d); }
function eachDate(startKey, endKey) {
  const start = localDateFromKey(startKey), end = localDateFromKey(endKey), out = [];
  if (end < start) throw new Error("結束日期不能早於開始日期。");
  const span = Math.round((end-start)/86400000)+1;
  if (span > 90) throw new Error("一次最多設定 90 天，避免誤操作。");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) out.push(dateKey(d));
  return out;
}
function eachStayNight(startKey, endKey) {
  const start = localDateFromKey(startKey), end = localDateFromKey(endKey), out = [];
  if (end <= start) throw new Error("退房日期必須晚於入住日期。");
  const span = Math.round((end-start)/86400000);
  if (span > 90) throw new Error("一次最多設定 90 晚，避免誤操作。");
  for (let d = new Date(start); d < end; d.setDate(d.getDate()+1)) out.push(dateKey(d));
  return out;
}
async function loadAdminMonthStates() {
  const first = new Date(adminCalendarCursor.getFullYear(), adminCalendarCursor.getMonth(), 1);
  const last = new Date(adminCalendarCursor.getFullYear(), adminCalendarCursor.getMonth()+1, 0);
  const q = query(collection(db,"availability"), where(documentId(),">=",dateKey(first)), where(documentId(),"<=",dateKey(last)));
  const snap = await getDocs(q);
  adminMonthStates = new Map(snap.docs.map(d => [d.id, d.data()]));
}
async function renderAdminCalendar() {
  const grid = $("#adminCalendar");
  if (!grid || !db) return;
  await loadAdminMonthStates();
  const first = new Date(adminCalendarCursor.getFullYear(), adminCalendarCursor.getMonth(), 1);
  $("#adminCalMonth").textContent = new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"long"}).format(first);
  grid.replaceChildren();
  const start = new Date(first); start.setDate(1-first.getDay());
  const labels = {booked:"已預約",blocked:"暫停",available:"可詢問"};
  for (let i=0;i<42;i++) {
    const d = new Date(start); d.setDate(start.getDate()+i);
    const key = dateKey(d), data = adminMonthStates.get(key), status = data?.status || "available";
    const btn = document.createElement("button"); btn.type="button";
    btn.className = `admin-day ${d.getMonth()!==adminCalendarCursor.getMonth()?"outside":""} ${status} ${key===adminSelectedDate?"selected":""}`.trim();
    btn.innerHTML = `<span>${d.getDate()}</span><small>${labels[status] || "可詢問"}</small>`;
    btn.addEventListener("click", async () => {
      adminSelectedDate = key;
      $("#bookingStart").value = key; $("#bookingEnd").value = key;
      $("#bookingStatus").value = status;
      adminSelectedBookingId = data?.bookingId || ""; adminPaymentRecords = []; renderPaymentRecords();
      ["#bookingGuest","#bookingPhone","#bookingEmail","#bookingPeople","#bookingDeposit","#bookingNotes"].forEach(sel => $(sel).value = "");
      if (data?.bookingId) {
        const booking = await getDoc(doc(db,"bookings",data.bookingId));
        if (booking.exists()) {
          const b = booking.data();
          $("#bookingGuest").value = b.guestName || ""; $("#bookingPhone").value = b.phone || ""; $("#bookingEmail").value = b.email || "";
          adminSelectedBookingId = data.bookingId; loadFinanceBooking(b);
          $("#bookingPeople").value = b.people || ""; $("#bookingDeposit").value = b.deposit || ""; $("#bookingNotes").value = b.notes || "";
          if (b.startDate) $("#bookingStart").value = b.startDate; if (b.endDate) $("#bookingEnd").value = b.endDate;
        }
      }
      toggleBookingPrivateFields(); renderAdminCalendar();
    });
    grid.append(btn);
  }
}
function toggleBookingPrivateFields() {
  $("#bookingPrivateFields")?.classList.toggle("hidden", $("#bookingStatus")?.value !== "booked");
}
function clearBookingEditor() {
  const key = adminSelectedDate || dateKey(new Date());
  $("#bookingStart").value = key; $("#bookingEnd").value = key; $("#bookingStatus").value = "booked";
  ["#bookingGuest","#bookingPhone","#bookingEmail","#bookingPeople","#bookingDeposit","#bookingNotes"].forEach(sel => $(sel).value = "");
  toggleBookingPrivateFields();
}
async function saveBookingDates(event) {
  event.preventDefault();
  const startDate=$("#bookingStart").value, endDate=$("#bookingEnd").value, status=$("#bookingStatus").value;
  if (!startDate || !endDate) return message("#bookingMessage","請先選擇日期。","error");
  let dates; try { dates = status === "booked" ? eachStayNight(startDate,endDate) : eachDate(startDate,endDate); } catch (e) { return message("#bookingMessage",e.message,"error"); }
  if (!confirm(`確定要將 ${startDate} ～ ${endDate} 設為「${status==='booked'?'已預約':status==='blocked'?'暫停開放':'可詢問'}」嗎？`)) return;
  message("#bookingMessage","正在儲存…");
  try {
    const batch=writeBatch(db); let bookingId="";
    if (status === "booked") {
      bookingId=crypto.randomUUID();
      batch.set(doc(db,"bookings",bookingId),{startDate,endDate,guestName:$("#bookingGuest").value.trim(),phone:$("#bookingPhone").value.trim(),email:$("#bookingEmail").value.trim(),people:Number($("#bookingPeople").value)||null,deposit:$("#bookingDeposit").value.trim(),notes:$("#bookingNotes").value.trim(),createdBy:auth.currentUser.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }
    for (const key of dates) {
      const refDoc=doc(db,"availability",key);
      if (status === "available") batch.delete(refDoc);
      else batch.set(refDoc,{status,bookingId:bookingId || null,updatedAt:serverTimestamp()});
    }
    await batch.commit();
    adminSelectedDate=startDate; message("#bookingMessage",`${dates.length} 天已更新。前台重新整理後就會看到新狀態。`,"success");
    await renderAdminCalendar();
  } catch (error) { message("#bookingMessage",error.message || "日期儲存失敗。","error"); }
}

async function cancelSelectedBooking() {
  const key = adminSelectedDate || $("#bookingStart").value;
  if (!key) return message("#bookingMessage", "請先在左側日曆點選一個已預約日期。", "error");
  message("#bookingMessage", "正在讀取預約資料…");
  try {
    const daySnap = await getDoc(doc(db, "availability", key));
    if (!daySnap.exists() || daySnap.data()?.status !== "booked") {
      return message("#bookingMessage", "這一天目前不是已預約狀態。", "error");
    }
    const bookingId = daySnap.data()?.bookingId || "";
    if (!bookingId) {
      if (!confirm(`確定要將 ${key} 恢復為可詢問嗎？這筆日期沒有綁定預約編號。`)) return;
      await deleteDoc(doc(db, "availability", key));
      await renderAdminCalendar();
      return message("#bookingMessage", `${key} 已恢復可詢問。`, "success");
    }
    const bookingRef = doc(db, "bookings", bookingId);
    const bookingSnap = await getDoc(bookingRef);
    const booking = bookingSnap.exists() ? bookingSnap.data() : {};
    const label = booking?.guestName ? `（${booking.guestName}）` : "";
    if (!confirm(`確定取消這筆預約${label}？\n系統會一次釋出所有綁定日期。`)) return;
    const q = query(collection(db, "availability"), where("bookingId", "==", bookingId));
    const days = await getDocs(q);
    const batch = writeBatch(db);
    days.forEach((snap) => batch.delete(snap.ref));
    if (bookingSnap.exists()) {
      batch.set(bookingRef, { status:"cancelled", cancelledAt:serverTimestamp(), updatedAt:serverTimestamp() }, { merge:true });
    }
    await batch.commit();
    adminSelectedDate = key;
    await renderAdminCalendar();
    message("#bookingMessage", `預約已取消，${days.size} 天已恢復可詢問。`, "success");
  } catch (error) {
    console.error("cancel booking failed", error);
    message("#bookingMessage", error?.message || "取消預約失敗。", "error");
  }
}




function money(value){ return `NT$ ${Math.round(Number(value)||0).toLocaleString("zh-TW")}`; }
function paymentSignedAmount(r){ const n=Math.abs(Number(r.amount)||0); return r.method==="refund" ? -n : n; }
function financeReceived(){ return adminPaymentRecords.reduce((sum,r)=>sum+paymentSignedAmount(r),0); }
function refreshFinanceSummary(){
  const total=Number($("#financeTotal")?.value)||0, received=financeReceived();
  if($("#financeReceived")) $("#financeReceived").textContent=money(received);
  if($("#financeBalance")) $("#financeBalance").textContent=money(Math.max(0,total-received));
}
function loadFinanceBooking(b={}){
  adminPaymentRecords=Array.isArray(b.paymentRecords)?b.paymentRecords:[];
  $("#financeTotal").value=Number(b.totalAmount ?? b.quotedTotal)||0;
  $("#financeDepositRequired").value=Number(b.depositRequired)||0;
  $("#paymentDate").value=dateKey(new Date());
  renderPaymentRecords(); refreshFinanceSummary();
}
function renderPaymentRecords(){
  const root=$("#paymentRecords"); if(!root) return; root.innerHTML="";
  if(!adminSelectedBookingId){ root.innerHTML='<p class="muted">請先從日曆點選一筆已預約資料。</p>'; refreshFinanceSummary(); return; }
  if(!adminPaymentRecords.length){ root.innerHTML='<p class="muted">目前沒有收款紀錄。</p>'; refreshFinanceSummary(); return; }
  const labels={bank_transfer:"銀行轉帳",cash:"現金",refund:"退款",other:"其他"};
  adminPaymentRecords.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).forEach(r=>{
    const row=document.createElement("div"); row.className="payment-row";
    row.innerHTML=`<span>${r.date||"—"}</span><strong class="${r.method==="refund"?"refund":""}">${r.method==="refund"?"−":""}${money(Math.abs(Number(r.amount)||0))}</strong><span>${labels[r.method]||r.method||"其他"}</span><span class="payment-note">${escapeHtmlAdmin([r.reference?`末五碼/參考 ${r.reference}`:"",r.note||""].filter(Boolean).join("｜")||"—")}</span><button class="secondary" type="button" data-payment-remove="${r.id}">刪除</button>`;
    root.append(row);
  });
  root.querySelectorAll("[data-payment-remove]").forEach(btn=>btn.addEventListener("click",async()=>{
    if(!confirm("確定刪除這筆收款紀錄？")) return;
    adminPaymentRecords=adminPaymentRecords.filter(r=>r.id!==btn.dataset.paymentRemove); await saveFinance(true); renderPaymentRecords();
  }));
  refreshFinanceSummary();
}
function escapeHtmlAdmin(v){ return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function saveFinance(silent=false){
  if(!adminSelectedBookingId) return message("#financeMessage","請先選擇一筆已預約資料。","error");
  const totalAmount=Number($("#financeTotal").value)||0, depositRequired=Number($("#financeDepositRequired").value)||0;
  const amountReceived=financeReceived(), balanceDue=Math.max(0,totalAmount-amountReceived);
  const accountingStatus=totalAmount>0 && balanceDue<=0 ? "paid" : amountReceived>0 ? "partial" : "unpaid";
  try{
    await setDoc(doc(db,"bookings",adminSelectedBookingId),{totalAmount,depositRequired,paymentRecords:adminPaymentRecords,amountReceived,balanceDue,accountingStatus,updatedAt:serverTimestamp()},{merge:true});
    if(!silent) message("#financeMessage","帳務資料已儲存。","success"); refreshFinanceSummary();
  }catch(e){ message("#financeMessage",e.message||"帳務儲存失敗。","error"); }
}
async function addPaymentRecord(){
  if(!adminSelectedBookingId) return message("#financeMessage","請先從日曆選擇一筆預約。","error");
  const amount=Number($("#paymentAmount").value)||0; if(amount<=0) return message("#financeMessage","請輸入收款金額。","error");
  const method=$("#paymentMethod").value;
  adminPaymentRecords.push({id:crypto.randomUUID(),date:$("#paymentDate").value||dateKey(new Date()),amount,method,reference:$("#paymentReference").value.trim(),note:$("#paymentNote").value.trim(),recordedAt:new Date().toISOString(),recordedBy:auth.currentUser?.uid||""});
  await saveFinance(true); $("#paymentAmount").value=""; $("#paymentReference").value=""; $("#paymentNote").value=""; renderPaymentRecords(); message("#financeMessage",method==="refund"?"退款紀錄已新增。":"收款紀錄已新增。","success");
}

function newSpecialRate(data={}) {
  return { id:data.id || crypto.randomUUID(), label:data.label || "連續假期", startDate:data.startDate || "", endDate:data.endDate || "", nightlyPrice:Number(data.nightlyPrice)||0 };
}
function renderSpecialRates(){
  const root=$("#specialRates"); if(!root) return; root.innerHTML="";
  if(!pricingSpecialRanges.length){
    const empty=document.createElement("p"); empty.className="muted"; empty.textContent="目前沒有特殊日期價格。"; root.append(empty); return;
  }
  pricingSpecialRanges.forEach((r,index)=>{
    const row=document.createElement("div"); row.className="special-rate-row";
    row.innerHTML=`<label>名稱<input data-field="label" value="${String(r.label||"").replace(/"/g,"&quot;")}" placeholder="例如：春節連假"></label><label>開始日期<input data-field="startDate" type="date" value="${r.startDate||""}"></label><label>結束日期<input data-field="endDate" type="date" value="${r.endDate||""}"></label><label>每晚價格<input data-field="nightlyPrice" type="number" min="0" step="100" value="${Number(r.nightlyPrice)||0}"></label><button class="secondary remove-special" type="button" aria-label="刪除特殊日期">×</button>`;
    row.querySelectorAll("input[data-field]").forEach(input=>input.addEventListener("input",()=>{ const field=input.dataset.field; pricingSpecialRanges[index][field]=field==="nightlyPrice"?Number(input.value)||0:input.value; }));
    row.querySelector(".remove-special").addEventListener("click",()=>{ pricingSpecialRanges.splice(index,1); renderSpecialRates(); });
    root.append(row);
  });
}
async function loadPricing(){
  if(!db) return;
  try{
    const snap=await getDoc(doc(db,"settings","pricing")); const d=snap.exists()?snap.data():{};
    $("#weekdayPrice").value=Number(d.weekdayPrice)||0; $("#weekendPrice").value=Number(d.weekendPrice)||Number(d.fridayPrice)||Number(d.saturdayPrice)||0;
    $("#holidayPrice").value=Number(d.holidayPrice)||0; $("#eventPrice").value=Number(d.eventPrice)||0; $("#bookingWindowMonths").value=Math.max(1,Math.min(Number(d.bookingWindowMonths)||6,18));
    $("#pricingEnabled").checked=d.enabled!==false; $("#autoGovernmentHolidays").checked=d.autoGovernmentHolidays!==false; $("#autoKentingEvents").checked=d.autoKentingEvents!==false;
    pricingSpecialRanges=Array.isArray(d.specialRanges)?d.specialRanges.map(newSpecialRate):[]; renderSpecialRates();
  }catch(e){ message("#pricingMessage",e?.message||"讀取價格設定失敗。","error"); }
}
async function savePricing(event){
  event.preventDefault();
  const weekdayPrice=Number($("#weekdayPrice").value), weekendPrice=Number($("#weekendPrice").value);
  const holidayPrice=Number($("#holidayPrice").value)||0, eventPrice=Number($("#eventPrice").value)||0, bookingWindowMonths=Math.max(1,Math.min(Number($("#bookingWindowMonths").value)||6,18));
  if(!(weekdayPrice>0&&weekendPrice>0)) return message("#pricingMessage","平日與週五／週六價格都必須大於 0。","error");
  for(const r of pricingSpecialRanges){ if(!r.label||!r.startDate||!r.endDate||!(Number(r.nightlyPrice)>0)||r.endDate<r.startDate) return message("#pricingMessage","請完整填寫特殊日期名稱、日期區間與價格。","error"); }
  message("#pricingMessage","正在儲存…");
  try{
    await setDoc(doc(db,"settings","pricing"),{enabled:$("#pricingEnabled").checked,weekdayPrice,weekendPrice,fridayPrice:weekendPrice,saturdayPrice:weekendPrice,holidayPrice,eventPrice,bookingWindowMonths,autoGovernmentHolidays:$("#autoGovernmentHolidays").checked,autoKentingEvents:$("#autoKentingEvents").checked,specialRanges:pricingSpecialRanges,updatedAt:serverTimestamp()});
    message("#pricingMessage",`價格設定已儲存。前台開放未來 ${bookingWindowMonths} 個月；官網不公開顯示價格。`,"success");
  }catch(e){ const msg=e?.code==="permission-denied"||String(e?.message||"").includes("Missing or insufficient permissions") ? "價格設定被 Firestore Rules 擋住。請到 Firebase → Firestore Database → Rules，發布此版本 firebase/firestore.rules 後再試。" : (e?.message||"價格設定儲存失敗。"); message("#pricingMessage",msg,"error"); }
}

function applyAdminDeepLink() {
  const params = new URLSearchParams(location.search);
  const requested=params.get("tab");
  if(requested==="operations"){
    const date=params.get("date");
    if(/^\d{4}-\d{2}-\d{2}$/.test(date||"")&&$("#orderArrivalFilter")){ $("#orderArrivalFilter").value=date; orderArrivalMode="date"; }
    document.querySelector('.tab[data-tab="operations"]')?.click();
    return;
  }
  const date = params.get("date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    adminSelectedDate = date;
    const d = localDateFromKey(date);
    adminCalendarCursor = new Date(d.getFullYear(), d.getMonth(), 1);
    renderAdminCalendar().catch((e)=>message("#bookingMessage",e.message,"error"));
  }
}
async function confirmBookingInAdmin(id){
  const b=opsBookings.find(x=>x.id===id);if(!b)return;const paid=paidFor(id),dep=Number(b.depositRequired||3000);
  if(paid<dep)return alert(`訂金尚未收足。\n應收 NT$ ${dep.toLocaleString("zh-TW")}\n目前已收 NT$ ${paid.toLocaleString("zh-TW")}`);
  if(!confirm(`確認訂單 ${id} 正式成立？\n${b.startDate} → ${b.endDate}\n確認後會鎖定日期，並通知有 Email／LINE 綁定的客戶。`))return;
  try{
    const token=await auth.currentUser.getIdToken();const r=await fetch("/api/admin-booking-confirm",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({bookingId:id})});const j=await r.json();
    if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
    alert(`預約已確認${j.emailSent?"，確認 Email 已寄出":""}${j.lineSent?"，LINE 客戶已通知":""}。`);await loadOperations();await renderAdminCalendar();
  }catch(e){alert(`確認失敗：${e.message||e}`);}
}


async function verifyReportedDeposit(id){
  const b=opsBookings.find(x=>x.id===id);if(!b)return;
  if(b.paymentReportStatus!=="pending")return alert("這筆訂單目前沒有待核帳的匯款回報。");
  const dep=Number(b.depositRequired||3000),amount=Number(b.paymentReportAmount||dep);
  if(!confirm(`確認銀行帳戶已收到這筆訂金？\n付款人：${b.paymentReportPayerName||"未填"}\n末五碼：${b.paymentReportLast5||"—"}\n金額：NT$ ${amount.toLocaleString("zh-TW")}\n\n確認後會正式新增收款紀錄。`))return;
  const refDoc=doc(collection(db,"paymentTransactions"));
  await setDoc(refDoc,{bookingId:id,type:"payment",amount,method:"轉帳",date:new Date().toLocaleDateString("en-CA"),last5:b.paymentReportLast5||"",note:`官方 LINE 匯款回報｜付款人 ${b.paymentReportPayerName||"未填"}`,isTest:Boolean(b.isTest),createdBy:auth.currentUser.uid,createdAt:serverTimestamp()});
  await setDoc(doc(db,"bookings",id),{paymentReportStatus:"verified",paymentReportVerifiedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
  await loadOperations();await syncBookingFinance(id);await loadOperations();
  alert("訂金已確認入帳。現在可在訂單卡上按『確認預約』。");
}

async function simulateTestDeposit(id){
  const b=opsBookings.find(x=>x.id===id);if(!b?.isTest)return;
  if(!confirm(`測試訂單 ${id}：模擬 NT$3,000 訂金已入帳？\n這不代表銀行實際收到款，只用於測試 LINE 確認流程。`))return;
  const refDoc=doc(collection(db,"paymentTransactions"));
  await setDoc(refDoc,{bookingId:id,type:"payment",amount:3000,method:"測試模擬",last5:"TEST",note:"測試模式模擬訂金入帳",date:new Date().toLocaleDateString("en-CA"),isTest:true,createdBy:auth.currentUser.uid,createdAt:serverTimestamp()});
  await loadOperations();await syncBookingFinance(id);await loadOperations();
  message("#testModeMessage",`已模擬 ${id} 訂金 NT$3,000 入帳，現在可直接在後台按「確認預約」。`,"success");
}
async function clearAllTestData(){
  const tests=opsBookings.filter(b=>b.isTest),ids=new Set(tests.map(b=>b.id));
  const relatedPayments=opsPayments.filter(x=>x.isTest||ids.has(x.bookingId));
  const relatedExpenses=opsExpenses.filter(x=>x.isTest||ids.has(x.bookingId));
  if(!tests.length&&!relatedPayments.length&&!relatedExpenses.length)return message("#testModeMessage","目前沒有測試資料。","success");
  if(!confirm(`確定清除全部測試資料？\n測試訂單 ${tests.length} 筆、收退款 ${relatedPayments.length} 筆、支出 ${relatedExpenses.length} 筆。\n此動作無法復原。`))return;
  const batch=writeBatch(db);relatedPayments.forEach(x=>batch.delete(doc(db,"paymentTransactions",x.id)));relatedExpenses.forEach(x=>batch.delete(doc(db,"expenseTransactions",x.id)));tests.forEach(x=>batch.delete(doc(db,"bookings",x.id)));await batch.commit();
  message("#testModeMessage","測試訂單與相關測試帳務已全部清除。","success");await loadOperations();
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
    ["photos", "library", "operations", "reports", "inventory", "pricing", "copy", "publish"].forEach((name) => $(`#${name}Panel`).classList.toggle("hidden", name !== button.dataset.tab));
    if (button.dataset.tab === "operations") loadOperations().catch((e)=>console.error(e));
    if (button.dataset.tab === "reports") loadReports().catch((e)=>console.error(e));
    if (button.dataset.tab === "inventory") loadInventoryManagement().catch((e)=>console.error(e));
    if (button.dataset.tab === "pricing") loadPricing();
    if (button.dataset.tab === "library") loadLibrary();
  }));
  $("#photoInput").addEventListener("change", (event) => {
    selectedFiles = [...event.target.files];
    renderSelectionPreview();
    if (selectedFiles.length) message("#uploadProgress", `已選擇 ${selectedFiles.length} 張。請先確認上方縮圖，再按「上傳到草稿」。`);
  });
  $("#clearSelection").addEventListener("click", () => {
    clearSelectedFiles();
    message("#uploadProgress", "已清除選取照片。");
  });
  $("#uploadButton").addEventListener("click", uploadPhotos);
  $("#addHeroFromLibrary").addEventListener("click", () => openLibraryPicker({type:"hero-add"}));
  $("#libraryUploadButton").addEventListener("click", () => uploadFilesToLibrary([...( $("#libraryInput").files || [] )]));
  $("#librarySearch").addEventListener("input", renderLibrary);
  $("#pickerSearch").addEventListener("input", renderPickerLibrary);
  $("#closeLibraryPicker").addEventListener("click", () => $("#libraryPickerDialog").close());
  $("#addPaymentRecord")?.addEventListener("click",addPaymentRecord);
  $("#saveFinanceSettings")?.addEventListener("click",()=>saveFinance(false));
  $("#financeTotal")?.addEventListener("input",refreshFinanceSummary);
  $("#pricingForm").addEventListener("submit",savePricing);
  $("#addSpecialRate").addEventListener("click",()=>{pricingSpecialRanges.push(newSpecialRate());renderSpecialRates();});
  $("#refreshOperations")?.addEventListener("click",()=>loadOperations());
  $("#refreshReports")?.addEventListener("click",()=>loadReports());
  $("#refreshInventory")?.addEventListener("click",()=>loadInventoryManagement());
  $("#inventoryItemForm")?.addEventListener("submit",saveInventoryItem);
  $("#stockMovementForm")?.addEventListener("submit",saveStockMovement);
  $("#reportStartDate")?.addEventListener("change",renderFinanceReport);
  $("#reportEndDate")?.addEventListener("change",renderFinanceReport);
  $("#downloadFinanceExcel")?.addEventListener("click",downloadFinanceExcel);
  $("#printFinanceReport")?.addEventListener("click",()=>window.print());
  $("#downloadInventoryExcel")?.addEventListener("click",downloadInventoryExcel);
  $("#printInventoryReport")?.addEventListener("click",()=>window.print());
  $("#clearLegacyOrders")?.addEventListener("click",clearLegacyOrderData);
  
  $("#orderFilterToday")?.addEventListener("click",()=>{orderArrivalMode="date";const d=new Date();$("#orderArrivalFilter").value=d.toLocaleDateString("en-CA");arrivalCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1);renderOperations();});
  $("#orderFilterNearest")?.addEventListener("click",()=>{setNearestArrivalFilter();const d=$("#orderArrivalFilter")?.value;if(d){const x=new Date(d+"T00:00:00");arrivalCalendarMonth=new Date(x.getFullYear(),x.getMonth(),1);}renderOperations();});
  $("#orderShowAll")?.addEventListener("click",()=>{orderArrivalMode="all";renderOperations();});
  $("#arrivalPrevMonth")?.addEventListener("click",()=>{arrivalCalendarMonth=new Date(arrivalCalendarMonth.getFullYear(),arrivalCalendarMonth.getMonth()-1,1);renderArrivalCalendar();});
  $("#arrivalNextMonth")?.addEventListener("click",()=>{arrivalCalendarMonth=new Date(arrivalCalendarMonth.getFullYear(),arrivalCalendarMonth.getMonth()+1,1);renderArrivalCalendar();});
  $("#paymentForm")?.addEventListener("submit",savePaymentRecord);
  $("#expenseForm")?.addEventListener("submit",saveExpenseRecord);
  $("#contentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      syncContentFormToDraft();
      await saveDraft();
    } catch (error) { message("#saveMessage", error.message, "error"); }
  });
  $("#previewButton").addEventListener("click", () => {
    try {
      syncContentFormToDraft();
      sessionStorage.setItem("lijiePreview", JSON.stringify(draft));
      $("#previewFrame").src = `../index.html?preview=1&t=${Date.now()}`;
      $("#previewDialog").showModal();
    } catch (error) { message("#saveMessage", error.message, "error"); }
  });
  $("#closePreview").addEventListener("click", () => $("#previewDialog").close());
  $("#restoreButton").addEventListener("click", async () => {
    const snapshot = await getDoc(doc(db, "publishedContent", "home"));
    if (!snapshot.exists()) return message("#publishMessage", "目前還沒有已發布版本。", "error");
    const currentLibrary = clone(draft._mediaLibrary || []);
    draft = clone(snapshot.data().content);
    ensureDraftShape();
    draft._mediaLibrary = currentLibrary;
    libraryAssets = draft._mediaLibrary;
    await saveDraft("草稿已恢復為目前官網版本。");
    fillForm(); renderPhotos();
    message("#publishMessage", "草稿已恢復，尚未重新發布。", "success");
  });
  $("#publishButton").addEventListener("click", async () => {
    if (!confirm("確定要將目前草稿發布到官網嗎？")) return;
    message("#publishMessage", "正在發布…");
    try {
      syncContentFormToDraft();
      await saveDraft();
      const publicContent = publicContentFromDraft();
      const batch = writeBatch(db);
      batch.set(doc(db, "publishedContent", "home"), { content: publicContent, publishedAt: serverTimestamp() });
      batch.set(doc(collection(db, "siteRevisions")), { slug: "home", content: publicContent, publishedBy: auth.currentUser.uid, createdAt: serverTimestamp() });
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
  applyAdminDeepLink();
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

// V6.55 營運管理：所有帳務、支出與庫存都可綁定 bookings/{bookingId}。
let opsBookings=[], opsPayments=[], opsExpenses=[], opsInventory=[];
let orderArrivalMode="date";
let arrivalCalendarMonth=new Date(); arrivalCalendarMonth.setDate(1);
const twd=n=>`NT$ ${Math.round(Number(n)||0).toLocaleString("zh-TW")}`;
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
function setOperationsDefaultDates(){const today=new Date().toLocaleDateString("en-CA");["#opsPaymentDate","#expenseDate","#stockDate"].forEach(x=>{if($(x)&&!$(x).value)$(x).value=today;});}
function financeStatusFor(b,paid){const total=Number(b.totalAmount??b.quotedTotal??0)||0,dep=Number(b.depositRequired||0)||0;if(b.status==="cancelled")return"已取消";if(b.status!=="confirmed"){if(!(dep>0))return"待設定訂金";if(paid>=dep)return"訂金已收／待後台確認";return"待收訂金";}if(total>0&&paid>=total)return"已結清";if(paid>0)return"部分付款／待尾款";return"待收款";}
function bookingLabel(b){return `${b.startDate||"—"}｜${b.guestName||"未填"}｜${b.id}`;}
function fillBookingSelects(){const options=['<option value="">不綁定訂單</option>',...opsBookings.map(b=>`<option value="${esc(b.id)}">${esc(bookingLabel(b))}</option>`)].join("");["#expenseBooking"].forEach(sel=>{if($(sel))$(sel).innerHTML=options;});if($("#opsPaymentBooking"))$("#opsPaymentBooking").innerHTML=['<option value="">請選訂單</option>',...opsBookings.map(b=>`<option value="${esc(b.id)}">${esc(bookingLabel(b))}</option>`)].join("");}
function fillInventorySelect(){if($("#stockItem"))$("#stockItem").innerHTML=['<option value="">請選備品</option>',...opsInventory.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}（${Number(i.quantity)||0} ${esc(i.unit||"")}）</option>`)].join("");}
async function readCollection(name){const snap=await getDocs(collection(db,name));return snap.docs.map(d=>({id:d.id,...d.data()}));}
async function loadOperations(){
  if(!db)return; setOperationsDefaultDates();
  [opsBookings,opsPayments,opsExpenses]=await Promise.all([readCollection("bookings"),readCollection("paymentTransactions"),readCollection("expenseTransactions")]);
  opsBookings.sort((a,b)=>String(a.startDate||"9999-99-99").localeCompare(String(b.startDate||"9999-99-99"))); opsPayments.sort((a,b)=>String(b.date||b.createdAt||"").localeCompare(String(a.date||a.createdAt||""))); opsExpenses.sort((a,b)=>String(b.date||b.createdAt||"").localeCompare(String(a.date||a.createdAt||""))); opsInventory.sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"zh-Hant"));
  fillBookingSelects();fillInventorySelect();
  if($("#orderArrivalFilter")&&!$("#orderArrivalFilter").value&&orderArrivalMode==="date") setNearestArrivalFilter();
  renderOperations();
  const params=new URLSearchParams(location.search),bid=params.get("booking");if(bid&&$("#opsPaymentBooking"))$("#opsPaymentBooking").value=bid;
}
function renderInventory(){
  const list=$("#inventoryList"); if(!list)return;
  list.innerHTML=opsInventory.length?opsInventory.map(i=>{
    const qty=Number(i.quantity)||0,min=Number(i.minQuantity)||0,isLow=qty<=min;
    return `<div class="inventory-row ${isLow?"low":""}"><strong>${esc(i.name||"未命名備品")}</strong><span>庫存 ${qty} ${esc(i.unit||"")}</span><span>安全庫存 ${min} ${esc(i.unit||"")}</span><small>${isLow?"⚠ 低庫存":"庫存正常"}</small></div>`;
  }).join(""):"<p class='muted'>尚未建立備品。</p>";
}
async function loadInventoryManagement(){
  if(!db)return;
  opsInventory=await readCollection("inventoryItems");
  opsInventory.sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"zh-Hant"));
  fillInventorySelect(); renderInventory(); setOperationsDefaultDates();
}
async function saveInventoryItem(e){
  e.preventDefault(); const name=$("#inventoryName").value.trim(),qty=Number($("#inventoryQty").value);
  if(!name||qty<0)return message("#inventoryItemMessage","請填寫備品名稱與庫存。","error");
  await setDoc(doc(db,"inventoryItems",crypto.randomUUID()),{name,unit:$("#inventoryUnit").value.trim(),quantity:qty,minQuantity:Number($("#inventoryMin").value)||0,unitCost:Number($("#inventoryCost").value)||0,createdBy:auth.currentUser.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  e.target.reset(); message("#inventoryItemMessage","備品已建立。","success"); await loadInventoryManagement();
}
async function saveStockMovement(e){
  e.preventDefault(); const itemId=$("#stockItem").value,qty=Number($("#stockQty").value),type=$("#stockType").value;
  if(!itemId||!(qty>0))return message("#stockMessage","請選備品並填寫數量。","error");
  const refDoc=doc(db,"inventoryItems",itemId),snap=await getDoc(refDoc); if(!snap.exists())return message("#stockMessage","找不到備品。","error");
  const item=snap.data(),before=Number(item.quantity)||0,after=type==="in"?before+qty:before-qty; if(after<0)return message("#stockMessage","庫存不足，不能扣成負數。","error");
  const batch=writeBatch(db);
  batch.set(refDoc,{quantity:after,updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(db,"inventoryTransactions",crypto.randomUUID()),{itemId,itemName:item.name,type,quantity:qty,beforeQuantity:before,afterQuantity:after,date:$("#stockDate").value,note:$("#stockNote").value.trim(),createdBy:auth.currentUser.uid,createdAt:serverTimestamp()});
  await batch.commit(); e.target.reset(); setOperationsDefaultDates(); message("#stockMessage","庫存已更新，進出庫紀錄已保存。","success"); await loadInventoryManagement();
}

function paidFor(id){return opsPayments.filter(x=>x.bookingId===id).reduce((s,x)=>s+(x.type==="refund"?-1:1)*(Number(x.amount)||0),0);}
function serviceRequestNotice(b){
  if(!b)return "";
  const blocks=[];
  if(b.cancellationRequestStatus==="pending"){
    blocks.push(`<div class="ops-request-alert cancellation-request-alert"><strong>客戶已提出取消預約申請</strong><span>原因：${esc(b.cancellationRequestReason||"未填")}</span></div>`);
  }
  if(b.refundRequestStatus==="pending"){
    blocks.push(`<div class="ops-request-alert refund-request-alert"><strong>客戶已提出退款申請</strong><span>原因：${esc(b.refundRequestReason||"未填")}</span></div>`);
  }
  if(b.status==="cancelled"){
    const reason=b.cancellationReason||b.cancellationRequestReason||"未填";
    const disposition=b.depositDispositionLabel||b.depositDisposition||"未記錄";
    const note=b.cancellationDepositNote||"";
    const refund=Number(b.cancellationRefundAmount||0);
    blocks.push(`<div class="ops-request-alert cancelled-order-alert"><strong>此訂單已取消</strong><span>取消原因：${esc(reason)}</span><span>訂金處理：${esc(disposition)}${refund>0?`｜退款 ${twd(refund)}`:""}</span>${note?`<span>取消備註：${esc(note)}</span>`:""}</div>`);
  }
  return blocks.join("");
}
function setNearestArrivalFilter(){
  const input=$("#orderArrivalFilter"); if(!input)return;
  const today=new Date().toLocaleDateString("en-CA");
  const upcoming=opsBookings.filter(b=>b.status!=="cancelled"&&b.startDate&&b.startDate>=today).sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate)));
  input.value=upcoming[0]?.startDate||today; orderArrivalMode="date";
}
function filteredOrdersForDisplay(){
  if(orderArrivalMode==="all")return [...opsBookings];
  const date=$("#orderArrivalFilter")?.value||"";
  return date?opsBookings.filter(b=>b.startDate===date):[];
}
function ymdLocal(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`;}
function bookingOccupiesNight(b,date){
  return b.status!=="cancelled" && b.startDate && b.endDate && date>=b.startDate && date<b.endDate;
}
function bookingDaySummary(date){
  const stayRows=opsBookings.filter(b=>bookingOccupiesNight(b,date));
  const arrivals=opsBookings.filter(b=>b.status!=="cancelled"&&b.startDate===date);
  const departures=opsBookings.filter(b=>b.status!=="cancelled"&&b.endDate===date);
  if(!stayRows.length&&!arrivals.length&&!departures.length)return {count:0,text:"無住宿",cls:"",stay:false,departure:false};
  const confirmed=stayRows.filter(b=>b.status==="confirmed").length;
  const pending=stayRows.filter(b=>b.status==="pending").length;
  const depositReady=stayRows.filter(b=>b.status==="pending"&&paidFor(b.id)>=Number(b.depositRequired||3000)).length;
  let parts=[];
  if(stayRows.length) parts.push(`${stayRows.length} 筆住宿`);
  if(arrivals.length) parts.push(`${arrivals.length} 入住`);
  if(departures.length) parts.push(`${departures.length} 退房`);
  if(confirmed)parts.push(`${confirmed} 已確認`);
  if(depositReady)parts.push(`${depositReady} 待確認`);
  else if(pending)parts.push(`${pending} 待訂金`);
  return {count:stayRows.length||arrivals.length||departures.length,text:parts.join("｜"),cls:confirmed&&confirmed===stayRows.length&&stayRows.length?"done":"warn",stay:stayRows.length>0,departure:departures.length>0};
}
function renderArrivalCalendar(){
  const grid=$("#arrivalCalendarGrid"),label=$("#arrivalMonthLabel"); if(!grid||!label)return;
  const y=arrivalCalendarMonth.getFullYear(),m=arrivalCalendarMonth.getMonth(); label.textContent=`${y} 年 ${m+1} 月`;
  const first=new Date(y,m,1),days=new Date(y,m+1,0).getDate(),selected=$("#orderArrivalFilter")?.value||"",today=ymdLocal(new Date());
  const cells=[]; for(let i=0;i<first.getDay();i++)cells.push('<button class="arrival-day is-empty" type="button" tabindex="-1"></button>');
  for(let d=1;d<=days;d++){
    const dt=new Date(y,m,d),date=ymdLocal(dt),sum=bookingDaySummary(date);
    const cls=["arrival-day",sum.count?"has-orders":"",sum.stay?"is-stay-night":"",sum.departure?"is-departure":"",date===selected?"is-selected":"",date===today?"is-today":""].filter(Boolean).join(" ");
    cells.push(`<button class="${cls}" type="button" data-arrival-date="${date}"><span class="arrival-day-num">${d}</span><span class="arrival-day-note ${sum.cls}">${esc(sum.text)}</span></button>`);
  }
  grid.innerHTML=cells.join("");
  grid.querySelectorAll("[data-arrival-date]").forEach(btn=>btn.addEventListener("click",()=>{const date=btn.dataset.arrivalDate;$("#orderArrivalFilter").value=date;orderArrivalMode="date";renderOperations();}));
}
function syncPaymentBookingOptions(){
  const sel=$("#opsPaymentBooking"); if(!sel)return;
  const date=$("#orderArrivalFilter")?.value||"";
  const rows=(orderArrivalMode==="all"?opsBookings:opsBookings.filter(b=>b.startDate===date)).filter(b=>b.status!=="cancelled");
  const current=sel.value;
  sel.innerHTML='<option value="">請選擇</option>'+rows.map(b=>`<option value="${esc(b.id)}">${esc(b.startDate||"—")}｜${esc(b.guestName||"未填")}｜${esc(b.id)}</option>`).join("");
  if(rows.some(b=>b.id===current))sel.value=current; else if(rows.length===1)sel.value=rows[0].id;
}
function renderOperations(){
  // 日曆優先渲染，避免單筆訂單資料異常時整個月曆一起消失。
  renderArrivalCalendar();
  const formalBookings=opsBookings.filter(b=>!b.isTest),formalIds=new Set(formalBookings.map(b=>b.id));
  const confirmed=formalBookings.filter(b=>b.status==="confirmed");const received=opsPayments.filter(x=>!x.isTest&&(!x.bookingId||formalIds.has(x.bookingId))).reduce((s,x)=>s+(x.type==="refund"?-1:1)*(Number(x.amount)||0),0);const balance=confirmed.reduce((s,b)=>s+Math.max(0,(Number(b.totalAmount??b.quotedTotal)||0)-paidFor(b.id)),0);const expenses=opsExpenses.filter(x=>!x.isTest&&(!x.bookingId||formalIds.has(x.bookingId))).reduce((s,x)=>s+(Number(x.amount)||0),0);
  const displayOrders=filteredOrdersForDisplay(); const orders=$("#operationsOrders"); const filterDate=$("#orderArrivalFilter")?.value||""; if($("#orderFilterSummary"))$("#orderFilterSummary").textContent=orderArrivalMode==="all"?`顯示全部 ${opsBookings.length} 筆`:`入住日 ${filterDate||"—"}・${displayOrders.length} 筆`; orders.innerHTML=displayOrders.length?displayOrders.map(b=>{const paid=paidFor(b.id),total=Number(b.totalAmount??b.quotedTotal)||0,bal=Math.max(0,total-paid),fs=financeStatusFor(b,paid),cls=fs==="已結清"?"done":fs==="已取消"?"cancel":"warn";return `<article class="ops-order ${b.isTest?"test-order":""}"><div class="ops-order-head"><div><strong>${esc(b.guestName||"未填")}｜${esc(b.id)}${b.isTest?'<span class="test-badge">TEST</span>':''}</strong><div class="ops-order-meta"><span>${esc(b.startDate||"—")} → ${esc(b.endDate||"—")}</span><span>${Number(b.people)||"—"} 人</span><span>${esc(b.phone||"")}</span><span>${esc(b.email||"")}</span></div>${serviceRequestNotice(b)}${b.paymentReportStatus==="pending"?`<div class="ops-request-alert payment-report-alert"><strong>客戶已回報訂金｜待核帳</strong><span>付款人：${esc(b.paymentReportPayerName||"未填")}｜末五碼：${esc(b.paymentReportLast5||"—")}｜回報金額：${twd(b.paymentReportAmount||b.depositRequired||3000)}</span></div>`:""}</div><span class="status-pill ${cls}">${esc(b.status==="confirmed"?fs:b.status==="cancelled"?"已取消":"等待後台確認")}</span></div><div class="ops-order-money"><span>訂單總額<br><strong>${twd(total)}</strong></span><span>訂金<br><strong>${Number(b.depositRequired)>0?twd(b.depositRequired):"未設定"}</strong></span><span>已收<br><strong>${twd(paid)}</strong></span><span>未收<br><strong>${twd(bal)}</strong></span></div><div class="ops-order-actions"><button class="secondary" type="button" data-total="${esc(b.id)}">調整總額</button>${b.paymentReportStatus==="pending"&&paid<Number(b.depositRequired||3000)?`<button class="primary" type="button" data-verify-deposit="${esc(b.id)}">確認訂金入帳</button>`:""}${b.status==="pending"&&paid>=Number(b.depositRequired||3000)?`<button class="primary" type="button" data-confirm-booking="${esc(b.id)}">確認預約</button>`:""}${b.status!=="cancelled"?`<button class="danger" type="button" data-cancel="${esc(b.id)}">後台取消預約</button>`:""}</div></article>`}).join(""):`<p class='muted'>${orderArrivalMode==="all"?"目前沒有訂單。":"這個入住日目前沒有訂單。"}</p>`;
  orders.querySelectorAll("[data-total]").forEach(btn=>btn.addEventListener("click",()=>editOrderTotal(btn.dataset.total)));orders.querySelectorAll("[data-verify-deposit]").forEach(btn=>btn.addEventListener("click",()=>verifyReportedDeposit(btn.dataset.verifyDeposit)));orders.querySelectorAll("[data-confirm-booking]").forEach(btn=>btn.addEventListener("click",()=>confirmBookingInAdmin(btn.dataset.confirmBooking)));orders.querySelectorAll("[data-cancel]").forEach(btn=>btn.addEventListener("click",()=>cancelOrderById(btn.dataset.cancel)));
  syncPaymentBookingOptions();
}
async function syncBookingFinance(id){if(!id)return;const b=opsBookings.find(x=>x.id===id);if(!b)return;const paid=paidFor(id),total=Number(b.totalAmount??b.quotedTotal)||0;await setDoc(doc(db,"bookings",id),{paidAmount:paid,balanceAmount:Math.max(0,total-paid),financeStatus:financeStatusFor(b,paid),updatedAt:serverTimestamp()},{merge:true});}
async function savePaymentRecord(e){e.preventDefault();const bookingId=$("#opsPaymentBooking").value,amount=Number($("#opsPaymentAmount").value),type=$("#opsPaymentType").value;if(!bookingId||!(amount>0))return message("#opsPaymentMessage","請選訂單並填寫金額。","error");message("#opsPaymentMessage","正在儲存…");const id=crypto.randomUUID(),booking=opsBookings.find(b=>b.id===bookingId);await setDoc(doc(db,"paymentTransactions",id),{bookingId,type,amount,method:$("#opsPaymentMethod").value,date:$("#opsPaymentDate").value,last5:$("#opsPaymentLast5").value.trim(),note:$("#opsPaymentNote").value.trim(),isTest:Boolean(booking?.isTest),createdBy:auth.currentUser.uid,createdAt:serverTimestamp()});await loadOperations();await syncBookingFinance(bookingId);await loadOperations();e.target.reset();setOperationsDefaultDates();message("#opsPaymentMessage","收款／退款紀錄已新增，訂單進度已自動更新。","success");}

async function editOrderDeposit(id){const b=opsBookings.find(x=>x.id===id),current=Number(b?.depositRequired)||0;const raw=prompt(`輸入訂單 ${id} 的訂金金額（訂金收足後，官方 LINE 才能按確認成立）`,current?String(current):"");if(raw===null)return;const dep=Number(raw);if(!(dep>0)||!Number.isFinite(dep))return alert("請輸入大於 0 的訂金金額。");const total=Number(b?.totalAmount??b?.quotedTotal)||0;if(total>0&&dep>total)return alert("訂金不可大於訂單總額。");const paid=paidFor(id);await setDoc(doc(db,"bookings",id),{depositRequired:dep,financeStatus:financeStatusFor({...b,depositRequired:dep},paid),updatedAt:serverTimestamp()},{merge:true});await loadOperations();}
async function saveExpenseRecord(e){e.preventDefault();const amount=Number($("#expenseAmount").value);if(!(amount>0))return message("#expenseMessage","請填寫支出金額。","error");const bookingId=$("#expenseBooking").value||null,booking=opsBookings.find(b=>b.id===bookingId);await setDoc(doc(db,"expenseTransactions",crypto.randomUUID()),{bookingId,category:$("#expenseCategory").value,amount,method:$("#expenseMethod").value,date:$("#expenseDate").value,note:$("#expenseNote").value.trim(),isTest:Boolean(booking?.isTest),createdBy:auth.currentUser.uid,createdAt:serverTimestamp()});e.target.reset();setOperationsDefaultDates();message("#expenseMessage","支出已新增。","success");await loadOperations();}
async function editOrderTotal(id){const b=opsBookings.find(x=>x.id===id),current=Number(b?.totalAmount??b?.quotedTotal)||0;const raw=prompt(`輸入訂單 ${id} 的總額`,String(current));if(raw===null)return;const total=Number(raw);if(total<0||!Number.isFinite(total))return alert("請輸入正確金額。");const paid=paidFor(id);await setDoc(doc(db,"bookings",id),{totalAmount:total,balanceAmount:Math.max(0,total-paid),financeStatus:financeStatusFor({...b,totalAmount:total},paid),updatedAt:serverTimestamp()},{merge:true});await loadOperations();}
function updateCancellationRefundFields(){
  const disposition=$("#cancelDepositDisposition")?.value||"";
  const fields=$("#cancelRefundFields"); if(!fields)return;
  const show=disposition==="refund_partial"||disposition==="refund_full";
  fields.classList.toggle("hidden",!show);
  if(!show){$("#cancelRefundAmount").value="";return;}
  const id=$("#cancelBookingId")?.value||"";
  const paid=Math.max(0,paidFor(id));
  if(disposition==="refund_full") $("#cancelRefundAmount").value=paid>0?String(paid):"";
  else if($("#cancelRefundAmount").value===String(paid)) $("#cancelRefundAmount").value="";
}
function openCancellationSop(id){
  const b=opsBookings.find(x=>x.id===id); if(!b)return;
  $("#cancelBookingId").value=id; $("#cancelRequestedBy").value="customer"; $("#cancelReason").value=""; $("#cancelDepositNote").value="";
  const paid=paidFor(id); $("#cancelDepositDisposition").value=paid>0?"forfeit_full":"not_received";
  $("#cancelRefundAmount").value=""; $("#cancelRefundMethod").value="轉帳"; updateCancellationRefundFields();
  $("#cancellationForm").classList.remove("hidden");
  message("#cancellationMessage",`正在處理 ${id}｜${b.guestName||"未填"}｜目前淨收 ${twd(paid)}。請確認取消原因與訂金處理。`);
  $("#cancellationForm").scrollIntoView({behavior:"smooth",block:"center"});
}
function closeCancellationSop(){ $("#cancellationForm").classList.add("hidden"); $("#cancelBookingId").value=""; }
async function confirmCancellationSop(){
  const id=$("#cancelBookingId").value, b=opsBookings.find(x=>x.id===id); if(!b)return;
  const reason=$("#cancelReason").value.trim(), requestedBy=$("#cancelRequestedBy").value, depositDisposition=$("#cancelDepositDisposition").value, depositNote=$("#cancelDepositNote").value.trim();
  if(!reason)return message("#cancellationMessage","請先填寫客戶取消原因。","error");
  const labels={not_received:"尚未收訂金",forfeit_full:"訂金全額保留（沒收）",refund_partial:"部分退款",refund_full:"全額退款",other:"其他"};
  const paid=Math.max(0,paidFor(id));
  const needsRefund=depositDisposition==="refund_partial"||depositDisposition==="refund_full";
  let refundAmount=needsRefund?Number($("#cancelRefundAmount").value):0;
  if(depositDisposition==="refund_full") refundAmount=paid;
  if(needsRefund&&!(refundAmount>0))return message("#cancellationMessage","請填寫退款金額。","error");
  if(needsRefund&&refundAmount>paid)return message("#cancellationMessage",`退款金額不可大於目前淨收 ${twd(paid)}。`,"error");
  const refundMethod=$("#cancelRefundMethod").value||"轉帳";
  const refundLine=needsRefund?`\n退款：${twd(refundAmount)}（${refundMethod}）`:"";
  if(!confirm(`確認取消 ${id}（${b.guestName||"未填"}）？\n原因：${reason}\n訂金處理：${labels[depositDisposition]||depositDisposition}${refundLine}\n\n確認後會釋出日期，取消與收退款歷史都會保留。`))return;
  message("#cancellationMessage","正在取消並更新帳務…");
  const q=query(collection(db,"availability"),where("bookingId","==",id)),snap=await getDocs(q),batch=writeBatch(db); snap.docs.forEach(d=>batch.delete(d.ref));
  batch.set(doc(db,"bookings",id),{status:"cancelled",financeStatus:"已取消",cancellationRequestedBy:requestedBy,cancellationReason:reason,depositDisposition,depositDispositionLabel:labels[depositDisposition]||depositDisposition,cancellationDepositNote:depositNote,cancellationRefundAmount:refundAmount||0,cancellationRefundMethod:needsRefund?refundMethod:"",cancelledBy:auth.currentUser.uid,cancelledAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
  if(needsRefund){
    const refundId=crypto.randomUUID();
    batch.set(doc(db,"paymentTransactions",refundId),{bookingId:id,type:"refund",amount:refundAmount,method:refundMethod,date:new Date().toLocaleDateString("en-CA"),last5:"",note:[`取消退款｜${reason}`,depositNote].filter(Boolean).join("｜"),cancellationRefund:true,isTest:Boolean(b.isTest),createdBy:auth.currentUser.uid,createdAt:serverTimestamp()});
  }
  await batch.commit(); closeCancellationSop(); await loadOperations();
}
async function clearLegacyOrderData(){
  if(!opsBookings.length)return message("#legacyDataMessage","目前沒有訂單資料。","success");
  const bookingIds=new Set(opsBookings.map(b=>b.id));
  const relatedPayments=opsPayments.filter(x=>x.bookingId&&bookingIds.has(x.bookingId));
  const relatedExpenses=opsExpenses.filter(x=>x.bookingId&&bookingIds.has(x.bookingId));
  if(!confirm(`這會刪除目前所有訂單 ${opsBookings.length} 筆，以及綁定的收退款 ${relatedPayments.length} 筆、支出 ${relatedExpenses.length} 筆，並釋出相關日期。\n\n如果這些都是舊版／測試資料才按確定。此動作無法復原。`))return;
  const verify=prompt('最後確認：請輸入「刪除舊資料」'); if(verify!=="刪除舊資料")return message("#legacyDataMessage","已取消，沒有刪除任何資料。","error");
  message("#legacyDataMessage","正在清除舊訂單資料…");
  const availabilitySnap=await getDocs(collection(db,"availability"));
  const refs=[]; relatedPayments.forEach(x=>refs.push(doc(db,"paymentTransactions",x.id))); relatedExpenses.forEach(x=>refs.push(doc(db,"expenseTransactions",x.id))); opsBookings.forEach(x=>refs.push(doc(db,"bookings",x.id))); availabilitySnap.docs.filter(d=>bookingIds.has(d.data()?.bookingId)).forEach(d=>refs.push(d.ref));
  for(let i=0;i<refs.length;i+=400){const batch=writeBatch(db);refs.slice(i,i+400).forEach(ref=>batch.delete(ref));await batch.commit();}
  orderArrivalMode="date"; if($("#orderArrivalFilter"))$("#orderArrivalFilter").value="";
  await loadOperations(); message("#legacyDataMessage","舊訂單、相關帳務與日期占用已清除。","success");
}
async function cancelOrderById(id){openCancellationSop(id);}

$("#cancelDepositDisposition")?.addEventListener("change",updateCancellationRefundFields);
$("#confirmCancellation")?.addEventListener("click",confirmCancellationSop);
$("#closeCancellation")?.addEventListener("click",closeCancellationSop);

// V6.80 報表中心：只讀取資料，不提供修改功能。
let reportInventory=[];
function reportDateValue(v){ return String(v||"").slice(0,10); }
function reportInRange(v,start,end){ const d=reportDateValue(v); if(!d)return false; return (!start||d>=start)&&(!end||d<=end); }
function xmlEsc(v){ return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }
function xlsxCol(n){ let out=""; for(let x=n+1;x>0;x=Math.floor((x-1)/26))out=String.fromCharCode(65+((x-1)%26))+out; return out; }
function xlsxCellXml(value,row,col,style=0){ const ref=`${xlsxCol(col)}${row+1}`; if(value===null||value===undefined||value==="") return `<c r="${ref}" s="${style}"/>`; if(typeof value==="number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`; return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`; }
function xlsxSheetXml(rows,opts={}){
  const titleRows=new Set(opts.titleRows||[]),headerRows=new Set(opts.headerRows||[]),currencyCols=new Set(opts.currencyCols||[]);
  const maxCols=Math.max(1,...rows.map(r=>r.length));
  const widths=Array.from({length:maxCols},(_,c)=>Math.min(34,Math.max(11,...rows.map(r=>String(r[c]??"").length+2))));
  const cols=`<cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const data=rows.map((r,ri)=>{const styleRow=titleRows.has(ri)?1:headerRows.has(ri)?2:0;return `<row r="${ri+1}"${titleRows.has(ri)?' ht="24" customHeight="1"':''}>${r.map((v,ci)=>xlsxCellXml(v,ri,ci,styleRow||((currencyCols.has(ci)&&typeof v==="number")?3:0))).join("")}</row>`}).join("");
  const filter=opts.autoFilterRange?`<autoFilter ref="${opts.autoFilterRange}"/>`:"";
  const freeze=opts.freezeRow?`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${opts.freezeRow}" topLeftCell="A${opts.freezeRow+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`:`<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<sheetFormatPr defaultRowHeight="18"/>${cols}<sheetData>${data}</sheetData>${filter}<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.2" footer="0.2"/></worksheet>`;
}
async function saveXlsx(name,sheets){
  if(!window.JSZip) throw new Error("Excel 元件尚未載入，請重新整理後再試。");
  const zip=new window.JSZip();
  zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.folder("_rels").file(".rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const xl=zip.folder("xl");
  xl.file("workbook.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sh,i)=>`<sheet name="${xmlEsc(String(sh.name).slice(0,31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>`);
  xl.folder("_rels").file("workbook.xml.rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  xl.file("styles.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="NT$ #,##0"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="16"/><color rgb="FF153F38"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF153F38"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFD8D2C7"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/></cellXfs></styleSheet>`);
  const ws=xl.folder("worksheets"); sheets.forEach((sh,i)=>ws.file(`sheet${i+1}.xml`,xlsxSheetXml(sh.rows,sh.options||{})));
  const blob=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",compression:"DEFLATE"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); a.remove();
}
function reportTable(headers,rows){ if(!rows.length)return `<p class="muted">此區間沒有資料。</p>`; return `<table class="report-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`; }
function setReportDefaultDates(){ const end=new Date(),start=new Date(end.getFullYear(),end.getMonth(),1),fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; if($("#reportStartDate")&&!$("#reportStartDate").value)$("#reportStartDate").value=fmt(start); if($("#reportEndDate")&&!$("#reportEndDate").value)$("#reportEndDate").value=fmt(end); }
async function loadReports(){ setReportDefaultDates(); const [b,p,e,i]=await Promise.all([readCollection("bookings"),readCollection("paymentTransactions"),readCollection("expenseTransactions"),readCollection("inventoryItems")]); opsBookings=b;opsPayments=p;opsExpenses=e;reportInventory=i.sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"zh-Hant")); renderFinanceReport();renderInventoryReport(); }
function reportPaidFor(id,payments){ return payments.filter(x=>x.bookingId===id).reduce((sum,x)=>sum+(x.type==="refund"?-Number(x.amount||0):Number(x.amount||0)),0); }
function renderFinanceReport(){
  const start=$("#reportStartDate")?.value||"",end=$("#reportEndDate")?.value||"";
  const bookings=opsBookings.filter(b=>reportInRange(b.startDate,start,end));
  const payments=opsPayments.filter(x=>reportInRange(x.date,start,end));
  const expenses=opsExpenses.filter(x=>reportInRange(x.date,start,end));
  const bookingTotal=bookings.reduce((s,b)=>s+Number((b.totalAmount??b.quotedTotal) || 0),0);
  const paymentsIn=payments.filter(x=>x.type!=="refund").reduce((s,x)=>s+Number(x.amount||0),0);
  const refunds=payments.filter(x=>x.type==="refund").reduce((s,x)=>s+Number(x.amount||0),0);
  const expenseTotal=expenses.reduce((s,x)=>s+Number(x.amount||0),0);
  const net=paymentsIn-refunds-expenseTotal;
  if($("#financeReportSummary"))$("#financeReportSummary").innerHTML=[["訂單數",`${bookings.length} 筆`],["訂單總額",twd(bookingTotal)],["收款",twd(paymentsIn)],["退款",twd(refunds)],["支出",twd(expenseTotal)],["淨現金流",twd(net)]].map(([a,b])=>`<div class="report-stat"><span>${a}</span><strong>${b}</strong></div>`).join("");
  const orderRows=bookings.sort((a,b)=>String(a.startDate||"").localeCompare(String(b.startDate||""))).map(b=>{const paid=reportPaidFor(b.id,opsPayments);const total=Number((b.totalAmount??b.quotedTotal)||0);return [b.id,b.guestName||"",b.startDate||"",b.endDate||"",`${Number(b.people)||0} 人`,b.status==="confirmed"?"已確認":b.status==="cancelled"?"已取消":"待確認",twd(total),twd(paid),twd(Math.max(0,total-paid)),b.cancellationReason||b.cancelReason||b.cancellationDepositNote||b.cancelDepositNote||""]});
  if($("#financeOrdersReport"))$("#financeOrdersReport").innerHTML=reportTable(["訂單編號","客戶","入住","退房","人數","狀態","訂單總額","淨已收","未收","備註"],orderRows);
  const paymentRows=payments.sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))).map(x=>[x.date||"",x.type==="refund"?"退款":"收款",x.bookingId||"",twd(x.amount),x.method||"",x.last5||"",x.note||""]);
  if($("#financePaymentsReport"))$("#financePaymentsReport").innerHTML=reportTable(["日期","類型","訂單編號","金額","方式","末五碼／來源","備註"],paymentRows);
  const expenseRows=expenses.sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))).map(x=>[x.date||"",x.category||"",x.bookingId||"",twd(x.amount),x.method||"",x.note||""]);
  if($("#financeExpensesReport"))$("#financeExpensesReport").innerHTML=reportTable(["日期","分類","訂單編號","金額","付款方式","備註"],expenseRows);
}
function renderInventoryReport(){
  const rows=reportInventory.map(i=>{const qty=Number(i.quantity)||0,min=Number(i.minQuantity)||0,cost=Number(i.unitCost)||0;return [i.name||"",`${qty} ${i.unit||""}`,`${min} ${i.unit||""}`,twd(cost),twd(qty*cost),qty<=min?"低庫存":"正常"]});
  const totalValue=reportInventory.reduce((s,i)=>s+(Number(i.quantity)||0)*(Number(i.unitCost)||0),0),low=reportInventory.filter(i=>(Number(i.quantity)||0)<=(Number(i.minQuantity)||0)).length;
  if($("#inventoryReportSummary"))$("#inventoryReportSummary").innerHTML=`<div class="report-stat"><span>備品種類</span><strong>${reportInventory.length} 項</strong></div><div class="report-stat"><span>低庫存</span><strong>${low} 項</strong></div><div class="report-stat"><span>庫存估值</span><strong>${twd(totalValue)}</strong></div>`;
  if($("#inventoryReportTable"))$("#inventoryReportTable").innerHTML=reportTable(["品名","目前庫存","安全庫存","單位成本","庫存估值","狀態"],rows);
}
async function downloadFinanceExcel(){
  const start=$("#reportStartDate")?.value||"",end=$("#reportEndDate")?.value||"";
  const bookings=opsBookings.filter(b=>reportInRange(b.startDate,start,end)),payments=opsPayments.filter(x=>reportInRange(x.date,start,end)),expenses=opsExpenses.filter(x=>reportInRange(x.date,start,end));
  const bookingTotal=bookings.reduce((sum,b)=>sum+Number((b.totalAmount??b.quotedTotal)||0),0),paymentsIn=payments.filter(x=>x.type!=="refund").reduce((sum,x)=>sum+Number(x.amount||0),0),refunds=payments.filter(x=>x.type==="refund").reduce((sum,x)=>sum+Number(x.amount||0),0),expenseTotal=expenses.reduce((sum,x)=>sum+Number(x.amount||0),0);
  const summary=[["俐姐的家｜訂單・帳務・支出報表"],["報表期間",`${start||"全部"} ～ ${end||"全部"}`],[],["指標","金額／數量"],["訂單數",bookings.length],["訂單總額",bookingTotal],["收款",paymentsIn],["退款",refunds],["支出",expenseTotal],["淨現金流",paymentsIn-refunds-expenseTotal]];
  const orderRows=[["訂單編號","客戶","入住","退房","人數","狀態","訂單總額","淨已收","未收","備註"],...bookings.sort((a,b)=>String(a.startDate||"").localeCompare(String(b.startDate||""))).map(b=>{const paid=reportPaidFor(b.id,opsPayments),total=Number((b.totalAmount??b.quotedTotal)||0);return [b.id,b.guestName||"",b.startDate||"",b.endDate||"",Number(b.people)||0,b.status==="confirmed"?"已確認":b.status==="cancelled"?"已取消":"待確認",total,paid,Math.max(0,total-paid),b.cancellationReason||b.cancelReason||b.cancellationDepositNote||b.cancelDepositNote||""]})];
  const paymentRows=[["日期","類型","訂單編號","金額","方式","末五碼／來源","備註"],...payments.sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))).map(x=>[x.date||"",x.type==="refund"?"退款":"收款",x.bookingId||"",Number(x.amount)||0,x.method||"",x.last5||"",x.note||""])];
  const expenseRows=[["日期","分類","訂單編號","金額","付款方式","備註"],...expenses.sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))).map(x=>[x.date||"",x.category||"",x.bookingId||"",Number(x.amount)||0,x.method||"",x.note||""])];
  try{ await saveXlsx(`俐姐的家-營運報表-${start||"全部"}-${end||"全部"}.xlsx`,[
    {name:"摘要",rows:summary,options:{titleRows:[0],headerRows:[3],currencyCols:[1]}},
    {name:"訂單",rows:orderRows,options:{headerRows:[0],currencyCols:[6,7,8],freezeRow:1,autoFilterRange:`A1:J${Math.max(1,orderRows.length)}`}},
    {name:"收款退款",rows:paymentRows,options:{headerRows:[0],currencyCols:[3],freezeRow:1,autoFilterRange:`A1:G${Math.max(1,paymentRows.length)}`}},
    {name:"支出",rows:expenseRows,options:{headerRows:[0],currencyCols:[3],freezeRow:1,autoFilterRange:`A1:F${Math.max(1,expenseRows.length)}`}}
  ]);}catch(e){ alert(`Excel 下載失敗：${e.message||e}`); }
}
async function downloadInventoryExcel(){
  const rows=[["品名","目前庫存","單位","安全庫存","單位成本","庫存估值","狀態"],...reportInventory.map(i=>{const q=Number(i.quantity)||0,m=Number(i.minQuantity)||0,c=Number(i.unitCost)||0;return [i.name||"",q,i.unit||"",m,c,q*c,q<=m?"低庫存":"正常"]})];
  try{ await saveXlsx("俐姐的家-庫存表.xlsx",[{name:"庫存表",rows,options:{headerRows:[0],currencyCols:[4,5],freezeRow:1,autoFilterRange:`A1:G${Math.max(1,rows.length)}`}}]); }catch(e){ alert(`Excel 下載失敗：${e.message||e}`); }
}
