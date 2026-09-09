# V6.38 — 管理卡獨立 Push + 完整提交診斷

## 核心修正
- 管理者卡與客戶卡永遠拆成兩次 LINE Push。
- 即使管理者 userId 與測試客戶 userId 相同，客戶卡格式錯誤也不會拖垮管理者「確認／取消」卡。
- 管理者卡新增「開啟後台日曆」按鈕，連到 `/admin/?tab=calendar&booking=...&date=...`。
- 後台支援 `?tab=calendar&date=YYYY-MM-DD` 深連結，自動切到預約日曆月份。

## Vercel 提交診斷
搜尋 `booking-submit-diag`，每次送出會依序記錄：
START → AUTH_OK → BOOKING_VALID → FIRESTORE_SAVED → OWNER_PUSH_PRECHECK → OWNER_PUSH_START → OWNER_PUSH_SUCCESS/ERROR → CUSTOMER_PUSH_START → CUSTOMER_PUSH_SUCCESS/ERROR → COMPLETE

LINE Push 另記錄 `booking-push-success` / `booking-push-error`，包含 HTTP status 與 LINE 回應（截斷，不記錄姓名、電話、備註）。

## 預期行為
客人送出後先存 Firestore；管理者立即收到一張獨立管理卡，含「確認預約」「取消預約」「開啟後台日曆」。客戶通知失敗不影響管理卡。
