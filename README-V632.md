# V6.32 — 官網日期帶入 + LINE 確認/取消

## 1. 官網日期會保留
官網日曆選好入住/退房後，不再跳 MINI App 開發網址，而是直接開：
`https://www.5-1bbs.com/line-booking.html?start=YYYY-MM-DD&end=YYYY-MM-DD&source=website`

若尚未登入 LINE Login，OAuth return URL 會保留 `start/end`，登入完成回到日曆後日期仍維持選取，不必重選。

## 2. 官方 LINE 管理者確認/取消
Vercel 新增：
`LINE_BOOKING_NOTIFY_TO=<俐姐管理者的 LINE userId>`

取得方式：用俐姐自己的 LINE 在「俐姐的家」官方帳號聊天室傳：
`管理者ID`
Webhook 會回覆自己的 LINE userId，複製到 Vercel 環境變數後 Redeploy Production。

新預約送出後：
- 客人收到「等待俐姐確認」卡片
- 管理者收到「新預約申請」卡片
- 管理者卡片有「確認預約」「取消預約」兩個按鈕
- 按確認：系統 Push「預約已確認」給該客人
- 按取消：系統 Push「預約已取消」給該客人
- 按鈕使用 HMAC 簽章 token，且只有 `LINE_BOOKING_NOTIFY_TO` 指定的 userId 能操作

## 3. 目前狀態
本版先完成 LINE 端確認/取消與客人通知。公開日曆的 `availability` 若要在按「確認預約」時自動標成已預約、按「取消」時自動釋放，需要再讓 Vercel 後端有 Firebase Admin 寫入權限；目前後台仍可手動管理日期狀態。
