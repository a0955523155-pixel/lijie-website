# V6.19 LINE 聊天室真正送出版

這版修正「送出後只跳到官方 LINE，但預約內容沒有進官方聊天室」的流程問題。

## 正確流程

1. 官網或外部瀏覽器開啟 MINI App，選日期並填資料。
2. 如果目前不是從官方 LINE 聊天室開啟，按送出時會先把資料保存在 MINI App 草稿，然後帶到俐姐的家官方 LINE。
3. 在官方 LINE 圖文選單點「立即預約」（連到 Developing MINI App：`https://miniapp.line.me/2011502071-EM878xNE`）。
4. MINI App 會自動恢復剛才的入住、退房、姓名、電話、人數、需求與備註。
5. 再按一次「LINE 傳送預約申請」，這次使用 `liff.sendMessages()`，預約文字會真正以客人的訊息送進俐姐的家官方 LINE 聊天室。
6. `/api/line-webhook` 收到訊息後，回覆漂亮的 Flex Message 預約確認卡。

## 為什麼要這樣做

LINE 不允許從 Safari / 官網直接開啟的 MINI App 冒充使用者，把訊息自動送進官方帳號聊天室。`liff.sendMessages()` 必須有聊天室 context，也就是從官方 LINE 聊天室 / Rich Menu 開啟 MINI App。

## Rich Menu 必要設定

官方 LINE 圖文選單的「立即預約」請連到：

`https://miniapp.line.me/2011502071-EM878xNE`

正式 Published 後再換成 Published MINI App URL。

## Webhook

維持：

`https://www.5-1bbs.com/api/line-webhook`

並確認 Use webhook = ON。

## Vercel 環境變數

- `LINE_CHANNEL_SECRET`：Messaging API Channel 2011504598 的 secret
- `LINE_CHANNEL_ACCESS_TOKEN`：Messaging API Channel 2011504598 的 token
- `LINE_MINIAPP_CHANNEL_ID=2011502071`

修改環境變數後要 Redeploy。
