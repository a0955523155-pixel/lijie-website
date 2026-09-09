// 住宿須知集中設定：前台 LINE 預約頁與官方 LINE 自動回覆共用。
// 若實際營運時間不同，只需改這一個檔案後重新部署。
export const BOOKING_RULES = {
  checkInFrom: "15:00",
  checkOutBy: "12:00",
  maxGuests: 12,
  payment: {
    depositAmount: 3000,
    depositMethod: "訂金固定 NT$3,000；須先完成訂金轉帳，訂金入帳後才可正式確認預約",
    balanceMethods: "尾款可轉帳或現金，實際付款時間以官方 LINE 確認內容為準",
    accountStatus: "付款資訊：高雄市鳥松區農會｜農分會代號 619-1089｜戶名 吳俐潔 小姐｜匯款帳號 01089210623310",
    bankName: "高雄市鳥松區農會",
    branchCode: "619-1089",
    accountName: "吳俐潔 小姐",
    accountNumber: "01089210623310"
  },
  notes: [
    "若預計較晚抵達，請先透過官方 LINE 告知。",
    "入住人數請依預約登記，整棟最多入住 12 人。",
    "夜間請降低音量，配合現場規範並維護鄰里安寧。",
    "日期送出後僅為預約申請；須先完成訂金並由俐姐於官方 LINE 按下確認，預約才正式成立。"
  ]
};

export function bookingRulesText() {
  return [
    `最早入住：${BOOKING_RULES.checkInFrom}`,
    `最晚退房：${BOOKING_RULES.checkOutBy}`,
    `付款方式：${BOOKING_RULES.payment.depositMethod}；${BOOKING_RULES.payment.balanceMethods}。`,
    `匯款資訊：${BOOKING_RULES.payment.accountStatus}。`,
    ...BOOKING_RULES.notes
  ];
}
