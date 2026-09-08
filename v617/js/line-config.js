// LINE MINI App / Official Account configuration
// LIFF ID 與 Channel ID 不是 secret，可安全放在前端。
export const lineConfig = {
  liffId: "2011502071-EM878xNE",
  miniAppChannelId: "2011502071",
  miniAppUrl: "https://miniapp.line.me/2011502071-EM878xNE",
  officialLineUrl: "https://lin.ee/w28dW98A",
  officialLineChatUrl: "https://line.me/R/oaMessage/%40287ppyfa/"
};

export const hasLiffId = () => lineConfig.liffId && !lineConfig.liffId.startsWith("YOUR_");
