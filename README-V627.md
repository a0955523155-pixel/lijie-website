# V6.27 — LIFF bootstrap fallback + cache fix

- 若 LINE WebView 快取到舊 HTML，找不到 `window.__LIFF_BOOTSTRAP__`，主模組會直接自行 `liff.init()`，不再卡在 `BOOTSTRAP_MISSING`。
- `BOOTSTRAP_MISSING` / init 失敗會直接 POST 到 `/api/liff-diagnostic`，Vercel Runtime Logs 一定看得到請求。
- `line-booking.html`、LINE 相關 JS 與診斷 API 全部加 `Cache-Control: no-store`，降低 LINE WebView 舊版快取干擾。
- JS cache key 升級到 `?v=627`。

測試方式：LINE 官方帳號 → 圖文選單 → 立即預約。
