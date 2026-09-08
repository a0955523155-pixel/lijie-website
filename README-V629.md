# V6.29 — 官方 LINE 安全預約連線（不依賴 LIFF 初始化）

## 為什麼改架構
目前 LINE MINI App 的 `liff.init()` 在此帳號環境持續回 `INVALID_ARGUMENT`，導致日曆雖能開啟，但無法可靠取得 userId / sendMessages。V6.29 直接取消預約送出的 LIFF 依賴。

## 新流程
1. LINE Official Account 圖文選單「立即預約」請改成 **文字動作：立即預約**（不要再填 MINI App URL）。
2. 使用者點圖文選單後，Webhook 會收到使用者 userId。
3. Webhook 回一張「開啟預約日曆」按鈕，URL 內含 2 小時有效的 HMAC 安全 session。
4. 使用者填表並送出，`/api/line-booking-submit` 驗證 session 後，直接用 Messaging API Push 把預約資料＋Flex 確認卡送回該使用者的官方 LINE 聊天室。
5. 不需要 `liff.init()`、不需要 `chat_message.write`、不需要客人手動再傳一次。

## Vercel 環境變數
必須存在：
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

選用：
- `LINE_BOOKING_NOTIFY_TO`：若填管理者 LINE userId，會額外收到新預約通知。

## 圖文選單設定
- 上方：官網 URL
- 左下「立即預約」：**文字** → `立即預約`
- 中下「入住須知」：文字 → `入住須知`
- 右下「聯絡俐姐」：文字 → `聯絡俐姐`
