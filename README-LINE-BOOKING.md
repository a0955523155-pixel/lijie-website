# 俐姐的家｜官方 LINE 預約日曆

這個版本已新增 `line-booking.html`，會直接讀取網站目前 Firestore 的 `availability` 日期狀態，因此官網與 LINE 看到的是同一套可預約日曆。

## 已完成

- LINE 內嵌版高質感預約 UI
- 月曆查看：可詢問／已預約／暫停開放
- 開始日＋結束日區間選擇
- 自動檢查區間中是否卡到已預約日期
- 姓名、電話、人數、活動類型、備註
- 自動整理成 LINE 預約訊息
- 在 LIFF 內可直接 `sendMessages()` 傳回聊天室
- 非 LINE 環境會自動複製內容並開啟目前官方 LINE 連結
- 客人個資不會直接寫進公開 Firestore 日曆

## 還差最後一次 LINE Developers 綁定

因為 LIFF ID 必須由你的 LINE Developers 帳號建立，無法由網站程式自行產生。

1. 到 LINE Developers，使用「俐姐的家」官方帳號所屬 Provider / Messaging API Channel。
2. 建立 LIFF App。
3. Endpoint URL 填：`https://你的網域/line-booking`
4. Size 建議：`Tall` 或 `Full`。
5. Scope 勾選：`openid`、`profile`、`chat_message.write`（要能直接傳訊息必須有 chat_message.write）。
6. 建立後會得到 LIFF ID，例如 `200xxxxxxxx-xxxxxxxx`。
7. 打開 `js/line-config.js`，把：

   `liffId: "YOUR_LIFF_ID"`

   改成你的 LIFF ID。
8. 部署到 Vercel。
9. LINE 官方帳號圖文選單的「立即預約」連結改成：

   `https://liff.line.me/你的_LIFF_ID`

完成後，客人從官方 LINE 點「立即預約」就會直接在 LINE 內開啟這個日曆。

## 注意

此版本是「預約申請」流程，不會在客人按下送出時直接把日期鎖成已預約。這樣可以避免惡意或誤觸把日期占滿。俐姐確認訂金／安排後，再到網站 `/admin/` 後台把日期設為「已預約」即可，官網與 LINE 日曆會同步更新。
