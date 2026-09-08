# 官網日曆 → LINE MINI App → 官方 LINE 自動回覆

## 新流程
1. 官網先選入住與退房日期。
2. 按「前往 LINE 完成預約」。
3. 系統開啟 LINE MINI App，日期會自動帶入，不需重選。
4. 客人填姓名／電話／人數／需求後按送出。
5. 若 MINI App 是從官方帳號聊天室 Rich Menu 開啟，使用 `liff.sendMessages()`，Webhook 自動回覆。
6. 若 MINI App 是從官網直接開啟，因 LINE 不允許這種情境使用 `liff.sendMessages()`，改由 `/api/line-booking-submit` 驗證 LINE ID Token，再由 Messaging API 直接由官方帳號回覆客人。

## Vercel 環境變數
必填：
- `LINE_CHANNEL_ACCESS_TOKEN`：俐姐的家官方 LINE Messaging API Channel Access Token
- `LINE_CHANNEL_SECRET`：Webhook 既有設定仍需保留

建議：
- `LINE_MINIAPP_CHANNEL_ID=2011502071`
- `LINE_BOOKING_NOTIFY_TO=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`（可選；設定後另外通知管理者 LINE）

## LINE Developers 必要條件
- LINE MINI App 與俐姐的家 Messaging API Channel 必須位於同一個 Provider。
- MINI App 必須可取得 `openid` / ID Token。
- 建議在 MINI App 啟用「Add friend option」並連結俐姐的家官方帳號，避免客人尚未加好友導致官方帳號無法 Push 回覆。

## Developing MINI App
- LIFF ID：`2011502071-EM878xNE`
- Channel ID：`2011502071`
- URL：`https://miniapp.line.me/2011502071-EM878xNE`

## 入住規則
- 入住：15:00 起
- 退房：12:00 前
