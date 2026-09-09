# V6.47 — 日曆手機版跑版修正

- LINE 預約日曆與官網公開日曆的 7 欄改為 `repeat(7, minmax(0, 1fr))`，避免價格與連假標籤撐寬欄位。
- 每個日期格強制 `min-width: 0`、`width: 100%`、文字截斷，避免 LINE WebView 橫向溢出。
- 560px / 390px 以下縮小間距、價格與標籤字級，保留 7 欄完整顯示。
- 加上水平 overflow 保護，避免整頁向右跑版。
- JS query 版本升至 v647，降低 LINE WebView 舊快取影響。
