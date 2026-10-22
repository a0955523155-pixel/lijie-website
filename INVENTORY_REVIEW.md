# 備品管理修改交付（待部署批准）

## 範圍與基準

- Repository：`a0955523155-pixel/lijie-website`；本機路徑 `C:\Users\user\Documents\Codex\2026-10-22\task\lijie-website`。
- 基準：`ea612d69375bf0d8eca9884ab915ef2a6e841196`，分支 `fix/inventory-types-and-delete-feedback`。開始時工作樹乾淨，沒有覆蓋使用者既有修改；repository 與祖先目錄未找到適用的 AGENTS.md。已閱讀既有 REVIEW.md、Firestore 技能與 Standard Web SDK 參考，以及完整流程驗證技能。
- 正式網站：`https://www.5-1bbs.com/`。本次沒有 push、PR、部署或正式業務資料寫入。test-app 的部署授權不適用。
- 僅執行 Firebase 資料庫中繼資料唯讀查核：`firestore:databases:list` 與 `firestore:databases:get '(default)'`，指定 project `li-jie-s-home-official-website`。結果為 `(default)`、`STANDARD`、`FIRESTORE_NATIVE`、`asia-east1`。
- Firebase rules、角色、帳號、憑證、網域、付費資源及 Vercel 設定均未修改；沒有資料遷移或正式資料刪除。

## 使用行為

刪除分為「deleteDoc 完成」與「清單重新讀取」兩階段。刪除成功即關閉確認窗、從本機清單移除並清除待刪 ID。若之後刷新失敗，顯示「已刪除，但清單刷新失敗，無須再次刪除」。權限拒絕、網路狀況和其他錯誤保留真實 error.code；權限錯誤只請操作者核對管理員資格與已發布規則，不宣稱 Rules 尚未發布。刪除進行中鎖住重複點擊與取消；刪除失敗後恢復可操作的確認窗。

庫存畫面提供設備資產、消耗品、送洗布品三類，以及待分類頁。舊項目缺少有效 `inventoryType` 時仍保留原資料、原數量，載入與重新整理不會補寫類型。須由操作者在編輯視窗明確選類型、起始狀態；設備／布品原數量全數歸入所選狀態，再以逐筆轉移分配。若分類時數量被另一人更新，交易會拒絕並要求重新核對。已存在的非空單位不能直接改寫；不進行單位換算。

| 類型 | 顯示與操作 |
| --- | --- |
| 設備資產 | 位置／房間、購入日期；在用／備用／維修／報廢。狀態轉移不扣除現有總數，報廢才減少現有總數，並保留報廢累計與原因。建議每件或同位置同購入批次各一筆，不同購入日另建項目。 |
| 消耗品 | 單位、實際進貨與領用、安全庫存及低量提醒；不依訂房自動扣除。 |
| 送洗布品 | 乾淨 → 房內使用 → 待洗 → 送洗中 → 乾淨；可部分回件。例如送洗 10 條、收回 8 條後，總數仍為 10，送洗中仍有 2 條。可從各狀態報廢，但須填原因。 |

新增、異動與編輯使用交易。庫存異動在同一交易內讀最新數量、驗證來源狀態及非負數，再同時寫入項目和歷史；不會只改數量卻漏掉紀錄。設備與布品使用整數，消耗品可用小數。新增項目另保存初始建檔紀錄。異動歷史保存類型、單位、前後數量、前後狀態、位置、購入日、操作者與日期；清單顯示最近 40 筆，不刪除更早歷史。既有缺少 createdAt 的歷史不會出現在依 createdAt 查詢的最近紀錄內，但仍保留原文件。

同頁表單重複送出會被鎖住；交易回覆遺失時保留操作 ID，以原內容重試會先查紀錄，不重複扣量。若結果尚未確認卻修改內容，要求先以原內容核對。操作 ID 保存在目前頁面的表單，重新載入頁面後應先核對數量和歷史，避免把同一筆異動重新登記。

房務工作台沿用同一模型與交易寫入，不再對設備／布品提供「領用／消耗」。待分類備品只可查看，交由管理員分類。庫存報表與 Excel 同步顯示類型和狀態，只有消耗品計算低庫存。

匯入清單改為新增待分類項目；與現有資料或檔案內同名會拒絕整批匯入，避免覆寫原庫存、單位或狀態。每批最多 400 筆，負數或無效數值拒絕，不再默默改成 0。匯入使用穩定 ID 與交易，已成功保存後的刷新錯誤不會顯示成匯入失敗。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `js/inventory-model.js` | 類型、狀態、數量／單位／日期驗證與錯誤訊息。純模型，不連線資料庫。 |
| `js/inventory-store.js` | 初始建檔及異動交易、同頁重試識別碼。 |
| `admin/admin.js`、`admin/index.html`、`admin/admin.css` | 刪除修正、三類管理、手動分類、歷史及報表。 |
| `housekeeping/housekeeping.js`、`housekeeping/index.html` | 共用類型及交易；避免房務舊流程覆寫狀態數量。 |
| `tests/inventory.test.mjs`、`tests/browser/inventory.spec.js` | 新增模型與操作驗收。 |
| `tests/browser/firebase-stub.js` | 可模擬權限拒絕、刪除後讀取失敗、交易衝突重試與遺失回覆；admins 不再只能模擬存在。 |
| `tests/browser/housekeeping.spec.js` | 將既有合成備品明確標為消耗品；另有新測試涵蓋舊資料待分類。 |
| `playwright.config.js`、`tests/static-server.mjs` | 測試可在 Windows Chrome 執行，仍可使用原 Linux Chromium；本機伺服器只綁 loopback。 |
| `rollback/inventory-freeze.patch` | 如上線後需要暫停庫存寫入，可套用的應用層唯讀修補。未套用至本次交付。 |

## 驗證證據

- `npm test`：69 項通過（原有 61 項 + 新增 8 項）。
- `npx playwright test`：46 項通過，包括原有後台、訂單、帳務、日曆、LINE 畫面及房務回歸。
- 新庫存瀏覽器案例包含：成功刪除、permission-denied、unavailable、其他真實錯誤碼、刪除成功但刷新失敗、重複點擊、取消／Escape、不改寫舊資料、明確分類及並行數量變更、三類建檔、設備維修／汰換、布品完整循環及部分回件、數量負值、防並行超扣、單位變更拒絕、交易失敗不部分寫入、遺失回覆重試、匯入不覆寫、缺 admins 文件及只讀回退。
- `npm run build`：45 份 JavaScript 語法檢查通過，產生 `dist/`，沒有部署。
- `git diff --check`、`git apply --check rollback/inventory-freeze.patch` 通過。回退驗收另外將 patch 套用到隔離暫存副本，透過瀏覽器驗證管理端五個及房務端兩個庫存寫入 handler 都被擋住、原數量不變。
- 手機／桌面 320、375、390、768、1440px 無頁面水平溢出；分類按鈕至少 44px。已人工查看手機截圖。`test-results/inventory-{width}.png` 與 `test-results/inventory-housekeeping-390.png` 為合成資料畫面；完整測試報告在 `playwright-report/index.html`。
- 所有瀏覽器 Firebase SDK 與外部 API 均攔截，測試寫入只在合成資料。這些測試不是正式 Firestore Rules、登入角色或真實離線行為的驗證；未執行 Firestore emulator。Safari／iOS 實機未驗證。

## 發布與回退

目前沒有部署批准。主對話可先審核本分支 diff、報告及畫面，再取得本專案明確部署批准。部署應使用真正綁定正式網站的專案；不能套用 test-app 的例外。Vercel 靜態 build 不會發布 Firestore Rules，本次沒有 rules diff 或 rules 發布需求。

初次使用新類型前，管理員與房務應關閉或重新載入舊版庫存頁，避免仍開著的舊程式直接改寫 quantity。這是現有規則未限制 schema 的相容性限制，不能透過本次前端修改保證所有舊客戶端停止寫入。

1. 尚未部署或尚無新類型資料：保留 main 基準即可放棄本分支；若已合併，使用 `git revert <本次交付 commit>` 產生可審核回退。沒有任何自動資料回復／刪除步驟。
2. 已產生新類型資料且需要停止寫入：優先在本次版本上套用 `git apply --check rollback/inventory-freeze.patch`，再 `git apply rollback/inventory-freeze.patch`，依相同建置流程產生唯讀版本，另經批准部署。此 patch 保留三類與歷史顯示，只停止應用程式內庫存新增、編輯、刪除、異動及匯入，不改 rules 或資料。它不會撤銷舊分頁或其他既有授權客戶端的寫入能力，故仍須停止使用並重載舊頁面。
3. 不可在新類型資料仍使用中時直接恢復原版庫存寫入介面，因舊介面會把設備／布品作一般進出庫。唯讀版本可繼續保留分類欄位和歷史，待修復版本審核後恢復操作；不要批次刪除、重設狀態或反向遷移正式資料。

正式已發布規則與當事登入角色仍未核實，因此原截圖中的刪除錯誤根因未確認。儲存庫規則允許 admins 文件存在者刪除 inventoryItems，房務不能刪除；此為程式證據，不等於正式環境已發布規則。本次已修正錯誤歸因和流程，沒有冒用正式資料測試權限。
