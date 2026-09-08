# V6.17 Messaging API Webhook

這一版把 LINE Official Account Manager 舊的「自動回覆／關鍵字回覆」改由 Messaging API Webhook 統一處理。

## Webhook URL
LINE Developers → Messaging API → Webhook URL 請使用：

`https://www.5-1bbs.com/api/line-webhook`

請勿使用 `https://5-1bbs.com/...`，因為目前該網址會 308 轉址到 `www`，LINE Verify 會判定失敗。

## 已加入功能
- 新好友 `follow` 事件：自動發送歡迎訊息。
- 歡迎訊息內含「立即預約」按鈕，開啟 LINE MINI App。
- 預約申請訊息：自動辨識 `【俐姐的家｜預約申請】` 並回覆完整預約確認與入住須知。
- 「預約／空房／日曆／日期」：回覆預約入口。
- 「最多／幾人／人數」：回覆最多 12 人。
- 「入住／退房／時間」：回覆 15:00 入住、12:00 退房。
- 「付款／訂金／轉帳／現金／匯款」：回覆訂金先轉帳、尾款可轉帳或現金、帳號確認後提供。
- 「房間／房型」：回覆雙人房 4 間＋四人房 1 間，共 5 間。
- 其他一般訊息：只做簡短「已收到」提示，不搶人工客服對話。

## Vercel Environment Variables
必要：
- `LINE_CHANNEL_SECRET`：Messaging API Channel 的 Channel secret
- `LINE_CHANNEL_ACCESS_TOKEN`：Messaging API Channel access token
- `LINE_MINIAPP_CHANNEL_ID=2011502071`

注意：前兩個一定是 Messaging API Channel `2011504598` 的憑證，不是 MINI App Developing / Review / Published secret。

## LINE 設定
- Use webhook：ON
- Webhook redelivery：建議 ON
- LINE Official Account Manager 原本舊的關鍵字回應／一律回應：維持關閉
- 歡迎訊息可由 Webhook 統一處理，不需要 OA Manager 再另外設定一套

## 目前入住與付款規則
- 最早入住：15:00
- 最晚退房：12:00
- 最多入住：12 人
- 訂金：一定先轉帳
- 尾款：可轉帳或現金
- 收款帳號：待設定，官方 LINE 確認預約後提供
