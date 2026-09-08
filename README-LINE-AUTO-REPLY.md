# 官方 LINE 預約日曆＋自動回覆設定

## 已完成的流程
1. 客人在 LIFF 日曆點「入住日」。
2. 再點「退房日」，系統自動計算住宿晚數並避開已預約／暫停日期。
3. 填姓名、電話、人數與需求。
4. 按「LINE 傳送預約申請」。
5. 預約內容會傳回官方 LINE 聊天室。
6. Messaging API Webhook 收到這則預約申請後，官方 LINE 自動回覆：入住日、退房日、住宿晚數、入住人數，以及最早入住／最晚退房與入住須知。

## 住宿時間設定
目前集中在 `js/booking-rules.js`：
- 最早入住：15:00
- 最晚退房：11:00
- 最多入住：12 人

如果實際營運時間不同，請先修改這個檔案再部署。

## 啟用官方 LINE 自動回覆
### 1. Vercel 環境變數
Vercel → Project → Settings → Environment Variables 新增：
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

兩個值都來自 LINE Developers 的 Messaging API Channel。請勿寫入 GitHub。

### 2. Webhook URL
部署完成後，在 LINE Developers → Messaging API → Webhook settings 填：
`https://你的正式網域/api/line-webhook`

按 Verify，成功後打開 Use webhook。

### 3. LIFF
LIFF Endpoint URL：
`https://你的正式網域/line-booking.html`

把 LIFF ID 填到 `js/line-config.js` 的 `liffId`。

### 4. 圖文選單
LINE 官方帳號圖文選單的「立即預約／查看空房」連到 LIFF URL。

## 安全
Webhook 會驗證 `x-line-signature`，只有通過 LINE Channel Secret 驗證的請求才會被處理。Webhook 只對以 `【俐姐的家｜預約申請】` 開頭的訊息自動回覆，不會搶回一般客人聊天訊息。
