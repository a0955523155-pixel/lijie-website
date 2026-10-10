# 俐姐的家：訂房交易、LINE 回報與手機後台修正

此交付為本機分支修改，尚未推送、發布或部署。

## 來源與授權範圍

- Repository：`a0955523155-pixel/lijie-website`，獨立 clone 至 `/workspace/lijie-fixes`。
- 分支：`fix/booking-integrity-mobile`。
- 最新 main 與提供基準相同：`4d9ea72eed4c54321bad272a6a4680af06ccc15a`；交付前再次以 `git ls-remote` 查核。
- 已檢查 repo 與工作區的 `AGENTS.md`、`.agents`、`.codex` 及 `SKILL.md`，未找到適用專案指示。
- 未修改預載 `test-app`、`factory-sales`，未讀寫正式訂單或付款，未發送真實 LINE／Email，未修改雲端憑證、權限、安全規則或索引。
- 人數限制為最多 12 位；正常住宿資料需至少 1 位，不設定最低成團、6 人或 10 人限制。既有價格計算、包棟費用與固定訂金／尾款政策保持原樣。

## 正式網域：唯讀查核

Vercel 回傳 `www.5-1bbs.com` 綁定 **lijie-home**，project ID `prj_90CqiFOypCpq6VBNT4G8UPvWEOda`，team ID `team_sj5wjsagGfkku9mAMR7qc4mb`，domain `verified: true`。`5-1bbs.com` 同屬此專案，308 轉址至 `www.5-1bbs.com`。

清單也列出 `lijie-website`（`prj_81hZEIYiJP9HQoaqWK5YjBMmyJGV`），但以專案名稱及 ID、相同 team 查詢 `/v9/projects/{idOrName}/domains` 均回傳 `404: not_found / Project not found`。此限制不影響正式網域已由 lijie-home 網域清單提供的正向證據。沒有更動任一專案。

## 六項修正與原始風險

| 項目 | 基準程式查核 | 分支結果 |
| --- | --- | --- |
| 1. 確認與日期競爭 | 先 `putBooking(confirmed)`，再逐日檢查／寫鎖；重試直接 `alreadyConfirmed` | REST read/write transaction 讀訂單與所有住宿晚數，再一次 commit 日期鎖及狀態；ABORTED 有界重試；訂金及取消狀態於交易內重查；既有 confirmed 仍驗證日期鎖，避免直接掩蓋歷史衝突 |
| 2. 日曆失敗與送出重查 | 無設定、讀取失敗或離線快取會視為空資料；送出直接存 pending | 僅成功的 server 讀取可建立可詢問狀態；失敗為無法確認、停用未知日期並提供重試；快取到期、頁面回到前景與送出時重新查核；伺服器交易再次查住宿晚數。申請保持 pending，不占用正式日期、不等於已確認。請求 ID／內容指紋提供重試去重 |
| 3. 匯款回報 | 文字可任選未取消訂單、覆寫 pending，沒有表單的核帳鎖及修正限制 | 文字與表單共用所有權、付款人、五碼、訂金金額、核帳鎖、一次修正及歷史紀錄驗證；交易只改回報欄位；相同內容重試不耗修正，webhook event ID 去重。多筆未指定訂單時顯示選擇。回報不修改已收款額、不確認預約。後台仍需人工確認銀行入帳 |
| 4. 訂單完整排序與分頁 | 先 limit 8 再排序、LINE 截取 4 筆 | 只查該 LINE 使用者的完整資料，再依即將入住、未完成、歷史訂單排序，每頁 3 筆；上一頁／查看更多 quick reply，支援 `查詢訂單 2`、`匯款回報 2`、`取消預約 2`；表單及服務申請亦要求精確的 LINE 綁定，不允許以猜編號認領無綁定資料 |
| 5. 對外文字 | JSON-LD 最大人數 10；客房出現管理別名文案；13 人會被自動改為 12 | JSON-LD、官網呈現與 LINE 統一最多 12；API 明確拒絕 13、零及非整數。客房改為照片與入住安排可向官方 LINE 確認；舊公開內容的管理文字在呈現時移除，不新增設施承諾 |
| 6. 手機後台 | 長資料、表格、操作按鈕及異步失敗流程需改善 | 320–390px 訂單卡、可展開詳情、核帳提示、取消退款表單、兩欄金額及操作；表格限區塊捲動；主要操作觸控目標、焦點及底部安全區；保存失敗保留輸入、同操作防重複。收款在失敗後重試沿用紀錄 ID，避免重複及覆寫已保存的不同內容；核帳、取消及日期寫入使用交易，保留原破壞性確認 |

取消／退款申請也改成交易中的部分欄位更新，避免與後台確認交錯時把舊的 status／finance 整筆寫回。申請仍不會直接取消、釋出日期或執行退款。

目前 HTML 實際提供的日期頁面是營運管理的入住／住宿區間日曆。舊 `saveBookingDates` 與日期編輯函式仍留在 JS，但對應表單已不在 HTML；沒有新增另一套頁面。已修正登入呼叫這些不存在欄位可能拋錯的問題，並為殘留日期寫入加上交易保護；該舊表單沒有進行瀏覽器操作驗收。

## 驗證與重跑

```sh
npm ci --cache /tmp/lijie-npm-cache
npm test
npm run test:browser
npm run build
git diff --check
```

- Node 隔離測試：**22 項通過**。使用隨機產生的假服務帳號、`demo-lijie-isolated` 與 REST 模擬；所有真實外部 fetch 均禁止。新增測試會在通知 API 讀到舊訂單後，於通知被攔截時插入確認或取消，再驗證記錄通知不覆寫最新狀態與日期鎖。其餘包含並行同日確認、失敗不部分提交、ABORTED 重試、歷史 confirmed 衝突、送出時過期房況、日期讀取失敗、1／12／13 人、申請／匯款去重、表單／文字修正與歷史一致、核帳锁、跨用戶隔離、14 筆分頁與排序、取消申請不覆寫確認狀態、快取到期與舊回應競爭。
- Chromium 瀏覽器隔離驗收：**9 項通過**。Firebase SDK 及 API 使用合成資料攔截，其他外部連線封鎖。測試 320、375、390、768、1440 寬度、觸控模擬、焦點、訂單詳情、日期日曆、核帳、取消退款、表格區塊捲動、日曆故障／重試、保存失敗、已保存後刷新失敗之重試、快速重複提交與確認失敗。截圖位於 `test-results/admin-{width}.png` 及 `test-results/line-375.png`；HTML 結果位於 `playwright-report/index.html`。
- 本機 static build：32 個應用 JavaScript 檔語法驗證、JSON-LD 容量驗證，產生 `dist/`。此專案原本沒有 build script；這是本機靜態產物及語法檢查，未執行 Vercel 雲端 build 或部署。
- `git diff --check` 通過。既有 `quoteStay` 價格邏輯、`holiday-market.js`、`public-pricing-calendar.js`、`booking-rules.js` 付款規則未變更。

## 限制與後續發布

- **Safari 真機、iOS LINE 內建瀏覽器與實體軟鍵盤未驗證**。目前手機驗收是 Chromium 尺寸／觸控模擬，不能替代真機。
- Firestore emulator 1.22.0 官方 jar 的下載，對 `storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar` 回傳 `Tunnel connection failed: 403 Forbidden`；故未跑真實 emulator。REST transaction 協定依 [Firebase beginTransaction](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/beginTransaction)、[transaction read](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/get) 與 [atomic commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit) 實作；本次並行及失敗驗證是隔離模擬，不是正式 Firestore 實測。
- 所有 LINE／Email 通知測試均為攔截；正式推送、正式服務帳號權限與正式資料索引狀況未驗證。此實作沿用單欄 `lineUserId` equality 查詢，不增加複合索引，也沒有發布任何規則或權限。
- LINE 每次分頁會讀該使用者全部訂單，以涵蓋缺少 `createdAt` 的舊資料並正確做混合優先排序；此小型網站方案的讀取成本隨該使用者歷史訂單數增加。
- 沒有讀取或修復既有正式資料；若歷史 confirmed 已與另一筆日期鎖衝突，程式會回報衝突，交由業者另行核對。無 LINE 綁定的舊訂單需由業者確認正確客戶後處理，不能自行以編號取得私人資料。
- 本機照片管理載入 bundled 預設圖片時，部分相對 URL 指向 `/admin/images/...` 會 404；屬既有照片管理問題，未納入本次六項範圍。營運／日曆／表格驗收沒有依賴這些圖片。
- 發布需父層確認本專案適用授權，並使用真正綁定正式網域的 **lijie-home**；預載 test-app 的自動部署授權不適用。此交付不代表上線。

## 回退

目前僅有本機分支提交，保留 main 基準即可放棄此分支。若日後把此提交合併至共享分支，使用 `git revert <此交付 commit>` 產生可審閱的回退提交；若已部署，另由已授權操作者在 lijie-home 回退至先前 deployment。程式回退不會移除新產生的回報歷史或交易紀錄，也不应自動修改任何正式訂單／付款。

## 補充查核與剩餘原子性限制

補查發現 `admin-customer-notify.js` 原本把先前讀到的完整訂單寫回通知紀錄，可能覆寫同時完成的 confirmed／cancelled。已改為交易內只更新通知欄位，並新增模擬此交错的 API 測試。未綁定現行 HTML 的舊 `cancelSelectedBooking()` 也改為交易重讀訂單與日期，仅刪除仍屬該訂單的鎖；沒有恢復舊表單或變更取消政策，該隱藏路徑仍未做瀏覽器操作驗收。

仍存在的限制如下，不能宣稱所有後台維護寫入都已原子化：

- 可見的「清除所有舊訂單資料」維持原雙重確認，是既有破壞性維護功能。它按 400 筆分批刪除，跨 batch 不原子，預先查詢也可與新的訂房寫入交錯。本次未執行或測試，不能用於正式訂單；若要求所有日期寫入路徑均有交易保護，須另行隔離或保護此維護功能。
- 「確認失敗不改狀態」是指撞期、交易被拒或 commit 未成功的情況。如果資料庫已 commit、回覆傳輸卻中斷，客戶端會暫時不知道結果，不能把所有網路錯誤都當成未寫入。重試會查既有訂單及日期鎖，避免重複建立申請或重送確認通知。
- LINE／Email 發送在資料交易之外；尚無交易式 outbox。通知可能漏送，退款／取消通知的並行請求亦不能保證 exactly-once。這些限制不會再透過通知紀錄覆寫訂單狀態，仍須另外處理通知可靠性。
- REST 模擬會保存每個交易 read-set 的文件版本；commit 發現版本變動就回 ABORTED，只有檢查通過才一次套用全部 writes。它驗證程式交易邊界、重試及失敗不部分提交，不能替代真正 Firestore／部署規則／網路行為驗證。
