// LINE Developers → LIFF → LIFF ID
// 建立 LIFF App 後，把 LIFF ID 貼在這裡即可啟用 LINE 內建功能。
// LIFF ID 不是 secret，可安全放在前端。
export const lineConfig = {
  liffId: "2011502071-EM878xNE",
  officialLineUrl: "https://lin.ee/w28dW98A"
};

export const hasLiffId = () => lineConfig.liffId && !lineConfig.liffId.startsWith("YOUR_");
