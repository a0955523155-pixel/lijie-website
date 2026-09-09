# V6.39 — LINE Flex Schema 修正版

修正客戶「待確認」Flex Message 被 LINE Messaging API 以 HTTP 400 拒絕的問題。

## 已修正
- 移除 LINE Flex Message 不支援的 `letterSpacing` 欄位。
- 保留原本深綠／米白／淡金質感設計。
- 管理員確認／取消卡、Firestore、官網日曆同步、完整提交診斷維持不變。

## 驗證方式
部署 Production 後送出一筆預約，Vercel Logs 應看到：
- `OWNER_PUSH_SUCCESS`
- `CUSTOMER_PUSH_SUCCESS`
- `COMPLETE` 且 `customerDelivered: true`

若 LINE 仍回 400，請提供 `CUSTOMER_PUSH_ERROR` 的 `response`，可以直接定位下一個 Flex 欄位。
