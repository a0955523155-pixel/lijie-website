# V6.37 日曆送出穩定修正版

- 修正舊 `?session=` 參數會蓋掉已登入 LINE Login cookie 的問題。
- 伺服器優先使用已驗證的 LINE Login cookie；沒有 cookie 才使用安全連結 session。
- 舊安全連結同時相容 `BOOKING_SESSION_SECRET` 與 `LINE_CHANNEL_SECRET` 簽章。
- Firestore 儲存不再依賴 LINE Push 成功；Push 僅作通知。
- LINE access token 暫時缺失/Push 失敗時，已存入 Firestore 的預約仍回傳成功。
- 前端錯誤訊息改為保留日期與已填資料，不再要求重新填寫。
- JS cache key 升為 v637。
