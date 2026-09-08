// 住宿須知集中設定：前台 LINE 預約頁與官方 LINE 自動回覆共用。
// 若實際營運時間不同，只需改這一個檔案後重新部署。
export const BOOKING_RULES = {
  checkInFrom: "15:00",
  checkOutBy: "11:00",
  maxGuests: 12,
  notes: [
    "若預計較晚抵達，請先透過官方 LINE 告知。",
    "入住人數請依預約登記，整棟最多入住 12 人。",
    "夜間請降低音量，配合現場規範並維護鄰里安寧。",
    "日期送出後為預約申請，仍須收到官方 LINE 確認才算完成預約。"
  ]
};

export function bookingRulesText() {
  return [
    `最早入住：${BOOKING_RULES.checkInFrom}`,
    `最晚退房：${BOOKING_RULES.checkOutBy}`,
    ...BOOKING_RULES.notes
  ];
}
