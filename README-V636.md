# V6.36｜Firestore 保單＋待確認預約＋管理者測試

## 新流程

1. 客人送出預約時，**先寫入 Firestore `bookings/{bookingId}`，狀態為 `pending`**。
2. Firestore 儲存成功後，前端一律顯示預約送出成功；LINE Push 只作通知，不再決定訂單是否遺失。
3. 管理者在「俐姐的家」官方 LINE 聊天室輸入 `待確認預約`：
   - Webhook 用 Reply API 回覆最多 4 筆待確認卡片。
   - 每張卡片有「確認預約」「取消預約」。
4. 按「確認預約」：
   - Firestore booking → `confirmed`
   - 官網 `availability` 依住宿晚數鎖定為 `booked`（退房日不鎖，方便下一組入住）。
   - 嘗試 Push 已確認卡給客人；Push 失敗也不影響預約確認。
5. 按「取消預約」：
   - booking → `cancelled`
   - 只釋出這筆 bookingId 綁定的日期。
   - 嘗試通知客人；Push 失敗也不影響取消。
6. 管理者輸入 `管理者測試`：
   - 檢查目前 userId 是否符合 `LINE_BOOKING_NOTIFY_TO`
   - 檢查 Messaging API access token（`/v2/bot/info`）
   - 實際測一次 Push 給管理者本人
   - 檢查 Firestore 是否已設定且可讀取

## Vercel 新增必要環境變數

推薦只新增一個：

`FIREBASE_SERVICE_ACCOUNT_JSON`

取得位置：Firebase Console → 專案設定 → Service accounts / 服務帳戶 → Generate new private key。
下載的 JSON **整份**壓成單行後貼到 Vercel Production。不要把 JSON 放進 GitHub。

也支援拆成三個：
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

原本環境變數繼續保留：
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_BOOKING_NOTIFY_TO`
- `BOOKING_SESSION_SECRET`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`

設定後必須 Production Redeploy。
