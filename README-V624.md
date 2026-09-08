# V6.24 LINE MINI App 初始化修正版

本版針對 `liff.init()` 直接回 `INVALID_ARGUMENT`：

1. `liff.init()` 改為官方最小參數，只傳 `liffId`。
2. 不再在 `liff.init()` 前讀取 URL query，避免干擾 `liff.state` / primary-secondary redirect。
3. init 成功後才讀取官網帶入的 `start/end` 日期。
4. 若 Developing 仍初始化失敗，請到 LINE Developers → MINI App → Roles，確認實機測試的 LINE 帳號對應 Business ID 具有 Admin 或 Tester；Developing 僅允許 Admin / Tester 測試。

Developing LIFF ID：2011502071-EM878xNE
Endpoint：https://www.5-1bbs.com/line-booking.html
