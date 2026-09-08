# V6.30 — 圖文選單直接進日曆 + LINE Login 身分綁定

目標流程：

1. 官方 LINE 圖文選單「立即預約」直接開 `https://www.5-1bbs.com/line-booking.html`
2. 第一次開啟時自動走 LINE Login（OAuth 2.1 / OpenID Connect）
3. 後端驗證 ID token，取得與 Messaging API 相同 provider 下的 LINE userId
4. 將 userId 放入 HttpOnly + Secure 的簽章 session cookie（7 天）
5. 客戶選日期、填資料、按送出
6. `/api/line-booking-submit` 直接用 Messaging API Push 回同一位客戶的官方 LINE 聊天室

## Vercel 必填環境變數

既有：
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

新增：
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`

建議新增：
- `BOOKING_SESSION_SECRET`：一組至少 32 bytes 的隨機字串；未設定時暫時沿用 `LINE_CHANNEL_SECRET`。

## LINE Developers 設定

需要一個 **LINE Login Channel**，而且必須和「俐姐的家」Messaging API Channel 放在 **同一個 Provider**。

Callback URL 加入：
`https://www.5-1bbs.com/api/line-auth-callback`

圖文選單「立即預約」改為 **連結**：
`https://www.5-1bbs.com/line-booking.html`

不需要再把「立即預約」設成文字動作。

## 相容性

V6.29 的 `?session=...` 安全連結仍保留，可做備援。
