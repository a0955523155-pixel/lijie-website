# V6.20 LINE 傳送權限修正版

此版針對 LINE MINI App 已從官方聊天室開啟，但按下「LINE 傳送預約申請」仍顯示傳送未完成的情況。

## 必做 LINE Console 設定
LINE Developers → LINE MINI App → Web app settings → Scopes：
- openid
- profile
- chat_message.write  ← 必須開啟

若 chat_message.write 已啟用但使用者尚未授權，V6.20 會在按送出時主動呼叫 LINE 的權限確認畫面，授權後再繼續送出。

## 成功條件
1. MINI App 必須從「俐姐的家」官方 LINE 一對一聊天室的圖文選單開啟。
2. `liff.getContext().type` 應為 `utou`。
3. `chat_message.write` 必須為 granted。
4. 送出純文字訊息後，LINE 平台會產生 webhook message event，Messaging API Webhook 再回 Flex 預約確認卡。

## 若仍失敗
畫面會顯示更精確原因（權限未授權／不是聊天 context／API 不可用），瀏覽器 console 也會記錄 `code`、`message` 與 LIFF context。
