# V6.45

- 週五與週六合併為單一「週五／週六每晚」價格。
- 舊資料相容：若只有 fridayPrice / saturdayPrice，後台會自動帶入；儲存後會同步寫入 weekendPrice 並保持舊欄位一致。
- 前台週五與週六都套用同一個 weekendPrice。
- 價格設定若被 Firestore Rules 擋住，後台會直接提示發布 `firebase/firestore.rules`。

## Firestore 權限
若看到 `Missing or insufficient permissions`，Vercel Redeploy 不會更新 Firestore Rules。請到 Firebase Console → Firestore Database → Rules，把本版本 `firebase/firestore.rules` 全部貼上並 Publish，或在 Firebase CLI 執行：

```bash
firebase deploy --only firestore:rules
```

規則只允許 `admins/{uid}` 存在的已登入管理員讀寫 `settings/pricing`。
