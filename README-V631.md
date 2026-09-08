# V6.31｜LINE Login 環境變數診斷版

- `/api/line-auth-start` 若環境變數缺少，不再只顯示「尚未設定完成」，會直接列出缺少的變數名稱。
- 新增 `/api/line-auth-health`：只回傳每個環境變數是否存在（true/false），絕不輸出 secret/token 值。
- 登入所需：LINE_LOGIN_CHANNEL_ID、LINE_LOGIN_CHANNEL_SECRET、BOOKING_SESSION_SECRET（或 LINE_CHANNEL_SECRET）。
- Messaging API 回傳所需：LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN。
- 環境變數新增/修改後必須重新 Redeploy Production。
