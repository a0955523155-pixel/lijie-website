# V6.18 修正
- 修正 iPhone Safari / LINE 內建瀏覽器鍵盤開啟時，第一次點「LINE 傳送預約申請」只收鍵盤、不觸發送出的問題。
- 送出按鈕改用 pointer/touch/click 三層事件，先 blur 鍵盤再送出。
- Messaging API 成功後回覆 LINE Flex 預約卡片＋純文字備援。
- `/api/line-booking-submit` 新增診斷 log：booking-submit / booking-push-success。
