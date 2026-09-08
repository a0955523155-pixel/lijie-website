# V6.26 — Vercel LIFF 診斷回報版

這版處理「手機 LINE MINI App 顯示 INVALID_ARGUMENT，但 Vercel Logs 完全沒有紀錄」的問題。

## 新增

- `/api/liff-diagnostic` Serverless Function
- LIFF 初始化開始、成功、失敗會主動 POST 診斷資料到後端
- `sendMessages()` 嘗試/失敗也會送診斷
- Vercel Runtime Logs 可搜尋：
  - `LIFF_BOOTSTRAP_START`
  - `LIFF_BOOTSTRAP_OK`
  - `LIFF_BOOTSTRAP_ERROR`
  - `LIFF_INIT_CATCH`
  - `LIFF_SEND_ATTEMPT`
  - `LIFF_SEND_ERROR`
- Vercel Requests 也會看到 `POST /api/liff-diagnostic`，狀態應為 200

## 隱私

診斷資料不會送：姓名、電話、預約備註、ID token、access token、cookie、URL query 值。
只會傳 host/path、query key 名稱、LIFF context、SDK/LINE 版本、瀏覽器 User-Agent 與錯誤 code/message。

## 測試

1. 部署 V6.26 到 `lijie-website` Production。
2. 完全關閉 LINE App 再開。
3. 官方 LINE → 圖文選單 → 立即預約。
4. 若仍顯示 INVALID_ARGUMENT，到 Vercel → `lijie-website` → Logs。
5. 時間範圍選最近 15 分鐘，搜尋 `LIFF_BOOTSTRAP_ERROR`；或搜尋 request path `/api/liff-diagnostic`。
6. 將那一筆 Messages 截圖即可定位下一步。
