# V6.35 — 管理卡優先送達 / LINE userId 診斷修正

- 預約送出時先推送管理者「確認預約 / 取消預約」卡，再嘗試推送客戶卡。
- 即使 LINE Login userId 無法被目前 Messaging API Push，預約仍會送到管理者，不再整筆失敗。
- 前端會明確提示是否為 LINE Login / Messaging API Provider 或 Access Token 對應問題。
- 管理者自己測試且兩邊 userId 一致時，客戶卡與管理卡仍會一起收到。
