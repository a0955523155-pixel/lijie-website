# V6.55｜官網預約＋LINE 確認＋營運帳務後台

## 預約流程
- 電腦版官網可直接選日期、人數並填姓名、電話、Email 後送出預約需求，不必先跳 LINE。
- 官網仍不顯示價格；官方 LINE 日曆仍顯示每日價格。
- 新預約存入 Firestore 後，管理者官方 LINE 收到預約卡片。
- 管理者 LINE 卡片只保留「確認預約」；取消與其他管理操作改到後台。
- LINE 按確認後會鎖定住宿日期、更新訂單為 confirmed，並寄確認 Email 給有填 Email 的客戶。
- 預約送出時亦會寄「已收到預約需求」Email 給客戶。
- 不寄任何管理員 Email。

## 營運管理後台
- 新增「營運管理」頁籤。
- 訂單、收款／退款、支出、備品庫存與進出庫可使用同一 bookingId 綁定。
- 收款紀錄保存金額、轉帳／現金、日期、帳號末五碼與備註。
- 每次收款或退款後自動重算已收、未收與帳務進度。
- 訂單可在後台調整總額或取消；取消後會釋出綁定日期。
- 支出可選擇綁定訂單，也可做一般營運支出。
- 備品可設定庫存、安全庫存、單位成本，並記錄進貨／領用；領用可綁定訂單。

## Gmail 設定
Vercel Environment Variables 需新增 GMAIL_CLIENT_ID、GMAIL_CLIENT_SECRET、GMAIL_REFRESH_TOKEN、GMAIL_SENDER_EMAIL；寄信使用 Gmail API OAuth，不使用 Gmail 密碼。

## Firebase
部署前請同步發布本版 firebase/firestore.rules，新增營運管理 collections 的管理員存取規則。
