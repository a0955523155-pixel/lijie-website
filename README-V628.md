# V6.28｜LINE 官方帳號預填訊息可靠備援

本版保留 LIFF `sendMessages()` 直送；若 LIFF 初始化、聊天室 context 或 `sendMessages()` 不可用，改用 LINE 官方支援的 `oaMessage` URL scheme：

- 直接開啟「俐姐的家」官方帳號聊天室
- 完整預約內容自動預填到訊息輸入框
- 使用者只需要再按一次「送出」
- 送出後原有 Messaging API Webhook 會收到訊息並回覆 Flex 預約卡片

官方帳號 ID：`@287ppyfa`

這個備援不會冒充使用者自動按送出；LINE 平台只允許在符合 LIFF 聊天室條件時用 `liff.sendMessages()` 代使用者送訊息。
