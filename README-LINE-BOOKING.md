# 俐姐的家｜官方 LINE 預約日曆（V6.5）

本版已完成 `line-booking.html`，可作為 LINE LIFF 預約日曆。它與官網共用 Firestore `availability`，因此後台改成「已預約／暫停開放」後，官網與 LINE 日曆會同步。

## 已完成
- LINE 內嵌手機版預約日曆
- 入住日 / 退房日區間選擇
- 已預約、暫停日期不可選
- 官網點日期會帶入 LINE 預約頁，例如 `line-booking.html?start=2026-09-20`
- 姓名、電話、人數、住宿需求與備註
- LIFF 環境可直接 `sendMessages` 傳回 LINE 聊天室
- 一般瀏覽器會複製預約內容，再開啟官方 LINE
- 不在前台顯示住宿費用

## LINE Developers 最後設定（帳號端必做一次）
1. 到 LINE Developers Console，使用「俐姐的家」官方帳號所屬 Provider。
2. 建立或選擇 LINE Login Channel。
3. 新增 LIFF App。
4. Endpoint URL 填：`https://你的正式網域/line-booking.html`
5. Size 建議選 Tall 或 Full。
6. Scope 至少開 `profile`、`chat_message.write`（實際可選項依 LINE Console 顯示）。
7. 建立完成後複製 LIFF ID。
8. 編輯 `js/line-config.js`，把 `YOUR_LIFF_ID` 換成真正的 LIFF ID。
9. 重新部署 Vercel。
10. 把 LIFF URL（通常為 `https://liff.line.me/你的LIFF_ID`）放到官方 LINE 圖文選單的「立即預約／查看空房」。

## 建議圖文選單按鈕
「查看空房・立即預約」→ LIFF URL

這樣客人會在官方 LINE 內直接看到日曆，而不是跳 Google Calendar。

## 官方 LINE 連結
目前 fallback 使用專案既有官方 LINE：`https://lin.ee/w28dW98A`。如官方帳號連結日後更換，請同步修改 `js/line-config.js`。


## V6.8 官網導流調整
官網不再直接開啟 MINI App。所有「LINE 預約」按鈕改為官方帳號加入連結：`https://lin.ee/w28dW98A`。客人加入官方 LINE 後，再由 Rich Menu 的「立即預約」開啟 MINI App 日曆。


## 付款規則
- 訂金：一定要先轉帳。
- 尾款：可轉帳或現金。
- 收款帳號：目前待設定；正式使用時由官方 LINE 確認預約後提供。
