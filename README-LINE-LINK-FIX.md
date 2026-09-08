# V6.11 LINE 連結修正

- 官方帳號 ID `@287ppyfa` 已依 LINE 官方規範 URL encode 為 `%40287ppyfa`。
- 官網一般「加入官方 LINE」按鈕使用：`https://line.me/R/ti/p/%40287ppyfa`。
- 官網日曆選完入住／退房後，改用 `oaMessage` 直接開啟官方帳號聊天，並把入住日、退房日、晚數、入住 15:00／退房 12:00 等文字預填到輸入框。
- 這可避免舊版因未 encode `@` 而跳到「搜尋好友」並顯示 ID 不存在。
