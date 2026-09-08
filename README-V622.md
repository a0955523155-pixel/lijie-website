# V6.22 LINE MINI App 精準診斷版

本版不再猜測 `INVALID_ARGUMENT` 的原因，會直接記錄 LIFF 實際執行狀態。

## 新增診斷

LINE MINI App 初始化後會在瀏覽器 console 顯示：

- `LIFF_DIAGNOSTIC`
- `contextType`（預期從一對一聊天室開啟時為 `utou`）
- `inClient`
- `sendMessagesAvailable`
- `viewType`
- 使用中的 LIFF ID

按「LINE 傳送預約申請」時會記錄：

- `LIFF_SEND_ATTEMPT`
- 如果失敗：`LIFF_SEND_ERROR`
- LINE error code / message
- contextType / inClient / sendMessagesAvailable

同時畫面會直接顯示診斷結果，例如：

`LINE 回傳 INVALID_ARGUMENT｜context=utou｜inClient=true｜sendMessages=true`

這樣可以明確判斷是聊天室 context、LIFF API 可用性，還是 LINE 平台本身回傳參數錯誤。

## 目前固定設定

Developing MINI App URL：
`https://miniapp.line.me/2011502071-EM878xNE`

Scopes：
- openid
- profile
- chat_message.write

Webhook：
`https://www.5-1bbs.com/api/line-webhook`
