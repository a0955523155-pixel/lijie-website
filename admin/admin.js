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
let adminMonthStates = new Map();
let libraryAssets = [];
let libraryPickerTarget = null;

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
      ["#bookingGuest","#bookingPhone","#bookingPeople","#bookingDeposit","#bookingNotes"].forEach(sel => $(sel).value = "");
      if (data?.bookingId) {
        const booking = await getDoc(doc(db,"bookings",data.bookingId));
        if (booking.exists()) {
          const b = booking.data();
          $("#bookingGuest").value = b.guestName || ""; $("#bookingPhone").value = b.phone || "";
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
  ["#bookingGuest","#bookingPhone","#bookingPeople","#bookingDeposit","#bookingNotes"].forEach(sel => $(sel).value = "");
  toggleBookingPrivateFields();
}
async function saveBookingDates(event) {
  event.preventDefault();
  const startDate=$("#bookingStart").value, endDate=$("#bookingEnd").value, status=$("#bookingStatus").value;
  if (!startDate || !endDate) return message("#bookingMessage","請先選擇日期。","error");
  let dates; try { dates = eachDate(startDate,endDate); } catch (e) { return message("#bookingMessage",e.message,"error"); }
  if (!confirm(`確定要將 ${startDate} ～ ${endDate} 設為「${status==='booked'?'已預約':status==='blocked'?'暫停開放':'可詢問'}」嗎？`)) return;
  message("#bookingMessage","正在儲存…");
  try {
    const batch=writeBatch(db); let bookingId="";
    if (status === "booked") {
      bookingId=crypto.randomUUID();
      batch.set(doc(db,"bookings",bookingId),{startDate,endDate,guestName:$("#bookingGuest").value.trim(),phone:$("#bookingPhone").value.trim(),people:Number($("#bookingPeople").value)||null,deposit:$("#bookingDeposit").value.trim(),notes:$("#bookingNotes").value.trim(),createdBy:auth.currentUser.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
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
    ["photos", "library", "calendar", "copy", "publish"].forEach((name) => $(`#${name}Panel`).classList.toggle("hidden", name !== button.dataset.tab));
    if (button.dataset.tab === "calendar") renderAdminCalendar().catch((e)=>message("#bookingMessage",e.message,"error"));
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
  $("#adminCalPrev").addEventListener("click",()=>{adminCalendarCursor=new Date(adminCalendarCursor.getFullYear(),adminCalendarCursor.getMonth()-1,1);renderAdminCalendar();});
  $("#adminCalNext").addEventListener("click",()=>{adminCalendarCursor=new Date(adminCalendarCursor.getFullYear(),adminCalendarCursor.getMonth()+1,1);renderAdminCalendar();});
  $("#bookingStatus").addEventListener("change",toggleBookingPrivateFields);
  $("#bookingForm").addEventListener("submit",saveBookingDates);
  $("#clearBookingForm").addEventListener("click",clearBookingEditor);
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
