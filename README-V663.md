# V6.63｜官網預約 400 診斷強化

- 官網預約 API 現在會在 Vercel Function Logs 留下明確錯誤代碼。
- 測試模式送出失敗時，官網會直接顯示實際錯誤代碼，方便定位 400。
- 正式模式仍只顯示友善中文，不曝光伺服器細節。
- `public-pricing-calendar` 的 `url.parse()` DeprecationWarning 與預約 400 無關，本版不把它當預約失敗處理。
