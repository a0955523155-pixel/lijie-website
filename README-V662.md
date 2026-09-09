# V6.62｜後台庫存遞迴與 Firestore 權限修正

- 修正「庫存管理」renderInventory() 自我呼叫造成 Maximum call stack size exceeded。
- 庫存分頁改為正常渲染品名、目前庫存、安全庫存與低庫存提醒。
- 修正「清除所有舊訂單資料」與管理員刪除收退款／支出資料時會被 Firestore 規則拒絕的問題。
- 管理員可刪除 bookings、paymentTransactions、expenseTransactions；一般訪客仍無權存取。
- 更新後必須重新發布 firebase/firestore.rules，否則線上 Firebase 仍會使用舊規則。
