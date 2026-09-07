# 預約日曆升級說明

這個版本已將 Google 預約日曆改為網站自己的 Firebase / Firestore 日曆。

## 這版包含
- 官網直接顯示月份日曆
- 可詢問 / 已預約 / 暫停開放 三種狀態
- 後台新增「預約日曆」分頁
- 後台可一次設定單日或連續日期
- 客人姓名、電話、人數、訂金、備註只存在私人 bookings 集合，前台無法讀取
- 前台點可詢問日期後，可直接帶日期前往 LINE 詢問

## 部署時多做一次 Firebase Rules 更新
網站檔案部署到 GitHub / Vercel 後，還需要把本專案內的 Firestore rules 發布到 Firebase，否則新的日曆集合會被舊規則擋住。

### 方法一：Firebase CLI
如果電腦已安裝 Firebase CLI，在專案根目錄執行：

```bash
firebase login
firebase use li-jie-s-home-official-website
firebase deploy --only firestore:rules
```

### 方法二：Firebase Console
1. 開啟 Firebase Console
2. 進入 Firestore Database
3. 點選 Rules / 規則
4. 打開專案內 `firebase/firestore.rules`
5. 將內容完整貼入 Firebase 規則頁面
6. 按「發布」

## 部署完成後測試
1. 進入 `你的網址/admin/`
2. 登入後台
3. 點「預約日曆」
4. 選一個日期或日期區間
5. 設成「已預約」或「暫停開放」
6. 回到前台重新整理，確認月曆狀態有同步變更

## 如果日曆顯示正常但無法儲存
通常代表 Firestore Rules 尚未發布，請先完成上面的 Rules 更新。
