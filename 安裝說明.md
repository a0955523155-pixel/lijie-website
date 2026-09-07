# 俐姐的家｜Firebase 後台安裝說明

此版本配合你目前的使用方式：網站程式碼放在 GitHub，由 Vercel 自動部署，原購買網域維持不變。後台網址為 `/admin/`，使用 Firebase 信箱與密碼登入。

## 目前已完成（2026-09-07）

- Firebase Web App 已建立，`js/config.js` 已填入實際專案設定。
- Email/Password 登入已啟用。
- 指定管理員帳號已建立（信箱不寫入公開 GitHub 文件）。
- Firestore 正式安全規則已發布。
- 對應的 `admins/{UID}` 文件已建立，欄位為 `role: "admin"`。
- 誤植帳號已刪除。
- Firebase Storage 已在 `ASIA-EAST1`（台灣）建立，Standard 儲存類別。
- Storage 正式安全規則已發布，並已附加跨服務規則所需權限。
- Firebase 授權網域已包含 `5-1bbs.com` 與 `www.5-1bbs.com`。
- 已修正 Firebase 即時資料連線所需的 CSP WebSocket 白名單。

## 第一次設定：建立 Firebase 專案

1. 登入 Firebase Console，按「建立專案」。
2. 專案名稱可填「俐姐的家官網」，Google Analytics 可依需求決定是否開啟。
3. 建立完成後，在專案首頁按 Web 圖示 `</>`，新增 Web 應用程式，名稱可填「俐姐的家網站」。
4. Firebase 會顯示一段 `firebaseConfig`。本交付版本已將實際設定填入 `js/config.js`。
5. Firebase Web 設定可放在前端；請勿放入 service account JSON、private key 或任何伺服器私鑰。

## 開啟信箱登入

1. Firebase Console → Authentication → Get started。
2. Sign-in method → Email/Password → 啟用第一個「Email/Password」，不要開啟 Email link。
3. Authentication → Users → Add user，建立你的管理信箱與密碼。
4. 密碼建議至少 12 碼，不要與其他網站共用。
5. 複製該使用者的 UID，稍後建立管理員名單會用到。

本網站沒有自行註冊頁面，只有你在 Firebase Console 手動建立的帳號才能登入。

## 建立 Firestore 與管理員名單

1. Firebase Console → Firestore Database → Create database。
2. 選擇離台灣較近、且符合你需求的區域；建立時可先選 Production mode。
3. 到 Firestore 的 Data 頁面建立 collection：`admins`。
4. 第一個 document 的 Document ID 填入前一步複製的管理員 UID。
5. 新增欄位 `role`，型態 string，值填 `admin`。
6. 將 `firebase/firestore.rules` 的全部內容貼到 Firestore → Rules，按 Publish。

網站內容會使用：

- `siteContentDrafts`：只有管理員能讀寫的草稿。
- `publishedContent`：公開網站只讀取已發布內容。
- `siteRevisions`：最近的發布版本。
- `admins`：允許登入後台的 UID 名單。

## Firebase Storage（已完成）

目前已建立預設 bucket，位置為 `ASIA-EAST1`，並已將 `firebase/storage.rules` 發布至 Storage → Rules。日後若修改規則，請重新發布同一份檔案內容。

規則限制只有 `admins` 名單內的帳號可上傳、更新或刪除；訪客只能讀取網站照片。允許 JPG、PNG、WebP，單張小於 8 MB。

專案目前使用 Blaze 即付即用方案；照片儲存、下載及網路傳輸量會依 Firebase／Google Cloud 當下費率與用量計費。

## 設定授權網域

Firebase Console → Authentication → Settings → Authorized domains（已完成）：

- 正式網域 `www.5-1bbs.com` 與 `5-1bbs.com` 已加入。
- 保留 Vercel 實際使用的 `*.vercel.app` 預覽／正式網域。
- 本機測試時可保留 `localhost`。

## GitHub＋Vercel 更新方式

1. 先備份舊 GitHub 專案。
2. 在原 GitHub 專案中刪除合約、SOP、Word、Excel 等非網站檔案。
3. 用本壓縮檔內的乾淨版本取代網站檔案，但不要刪除 Vercel 專案或網域設定。
4. Commit 並 Push 到 Vercel 已連接的 GitHub 分支。
5. Vercel 會自動部署；Framework Preset 使用 **Other**，不需要 Build Command。
6. 部署完成後測試首頁與 `https://你的網域/admin/`。

`.gitignore` 會避免常見私人文件再次加入 GitHub；`.vercelignore` 會阻止這些檔案被送入 Vercel 部署。

## 後台日常使用

- 登入：`/admin/`
- 「儲存草稿」：只保存到後台，不影響訪客。
- 「預覽草稿」：先查看新版畫面。
- 「正式發布」：更新訪客看到的內容。
- 「載入為草稿」：載回舊版本，確認後可重新發布。
- 照片：JPG、PNG、WebP；單張小於 8 MB。

## 上線前檢查

- Firebase 授權網域包含正式網域（已確認）。
- Firestore 與 Storage Rules 已發布正式規則（已確認）。
- `admins` 文件 ID 是 Firebase Authentication 使用者 UID，不是信箱。
- GitHub 沒有 service account、private key、密碼、合約、SOP 或 Excel。
- Vercel 正式網域的 HTTPS 憑證狀態正常。
- 已測試登入、上傳照片、儲存草稿、預覽與發布。

## 本機檢查

安裝 Node.js 後可執行 `npm run check`。不要直接雙擊 HTML，應使用本機網站伺服器預覽。
