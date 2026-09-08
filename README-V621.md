# V6.21 LINE MINI App 送出修正

本版針對 LINE 回傳 `INVALID_ARGUMENT` 修正。

## 修正
- 移除送出前 `liff.permission.query("chat_message.write")` 的預查。
- 直接由 `liff.sendMessages()` 觸發 LINE 官方驗證／授權流程。
- 保留聊天室 context 與 sendMessages API 可用性檢查。
- 若權限未開，會明確提示檢查 Developing > Web app settings > Scopes > chat_message.write。

## LINE Developers 必要設定
1. LINE MINI App > Web app settings > Developing > Scopes：勾選 `openid`、`profile`、`chat_message.write`。
2. Rich Menu 的「立即預約」必須連到 Developing MINI App URL：`https://miniapp.line.me/2011502071-EM878xNE`，不要直接連 endpoint URL。
3. 重新從官方 LINE Rich Menu 開啟 MINI App 後再測試。
