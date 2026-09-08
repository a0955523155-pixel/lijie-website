# V6.23 — LINE MINI App www Endpoint 一致性修正版

本版將專案內所有正式網站 URL 統一為 `https://www.5-1bbs.com`，避免 apex `https://5-1bbs.com` 308 redirect 到 `www` 後，造成 LIFF `liff.init()` 判定目前 URL 與 LINE Developers Endpoint URL 不同而回傳 `INVALID_ARGUMENT`。

## LINE Developers 必做
Developing Endpoint URL 請設定為：

`https://www.5-1bbs.com/line-booking.html`

不要使用：

`https://5-1bbs.com/line-booking.html`

因為你的 Vercel 正式站會將不含 www 的網址 308 轉址到 www。

## 測試方式
1. 儲存 Developing Endpoint URL。
2. 從官方 LINE 聊天室的 Rich Menu「立即預約」重新開啟 MINI App。
3. 頂部狀態不應再顯示 `LINE 初始化失敗：INVALID_ARGUMENT`。
4. `context=utou`、`inClient=true` 時，再按「LINE 傳送預約申請」。
