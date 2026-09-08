# V6.25 LIFF bootstrap-first 初始化修正版

本版將 `liff.init()` 提到所有 ES module、Firebase 與預約程式載入之前執行，避免 LIFF primary/secondary redirect 尚未完成時，被 module graph 延遲或其他前端程式干擾。

## 主要修正
- HTML 載入 LIFF SDK 後立即執行 `liff.init({ liffId })`。
- 初始化完成前不讀取、不改寫任何 `liff.*` query。
- Firebase 與預約 module 等 LIFF bootstrap 完成後才使用 LIFF API。
- JS 加入 `?v=625` cache-busting，避免 LINE WebView 仍使用舊版程式。
- 完整記錄 `LIFF_BOOTSTRAP_OK` / `LIFF_BOOTSTRAP_ERROR`。
- Privacy / Terms canonical URL 統一為 `www.5-1bbs.com`。

LINE Developers Developing Endpoint 維持：
`https://www.5-1bbs.com/line-booking.html`

Rich Menu 立即預約維持：
`https://miniapp.line.me/2011502071-EM878xNE`
