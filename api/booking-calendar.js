import crypto from "node:crypto";

function actionSecret(){ return process.env.BOOKING_SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || ""; }
function verifyActionToken(token){
  const [body,sig,extra]=String(token||"").split(".");
  if(!body||!sig||extra) throw new Error("INVALID_TOKEN");
  const expected=crypto.createHmac("sha256",actionSecret()).update(body).digest("base64url");
  const a=Buffer.from(sig), b=Buffer.from(expected);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) throw new Error("INVALID_TOKEN");
  const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
  if(!payload?.id||!payload?.ci||!payload?.co||!payload?.exp||Date.now()>Number(payload.exp)) throw new Error("EXPIRED_TOKEN");
  return payload;
}
function icsEscape(v=""){
  return String(v).replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
}
function dateTime(date,time){ return String(date).replaceAll("-","")+"T"+time; }

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).send("Method Not Allowed");
  try{
    if(!actionSecret()) throw new Error("SERVER_NOT_CONFIGURED");
    const p=verifyActionToken(req.query?.token);
    const uid=`${p.id}@5-1bbs.com`;
    const now=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
    const title="俐姐的家｜住宿預約";
    const desc=`預約編號：${p.id}\\n姓名：${p.n||"未填"}\\n入住 15:00 起／退房 12:00 前\\n如有行程異動，請透過俐姐的家官方 LINE 聯繫。`;
    const ics=[
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Lijie's Home//Booking Calendar//ZH-TW",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${icsEscape(uid)}`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=Asia/Taipei:${dateTime(p.ci,"150000")}`,
      `DTEND;TZID=Asia/Taipei:${dateTime(p.co,"120000")}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      "STATUS:CONFIRMED",
      "BEGIN:VALARM",
      "TRIGGER:-P1D",
      "ACTION:DISPLAY",
      "DESCRIPTION:明天入住俐姐的家",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
      ""
    ].join("\r\n");
    res.setHeader("Content-Type","text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition",`attachment; filename="lijie-home-${String(p.id).replace(/[^A-Za-z0-9_-]/g,"")}.ics"`);
    res.setHeader("Cache-Control","private, no-store, max-age=0");
    return res.status(200).send(ics);
  }catch(e){
    console.error("booking calendar error",e);
    return res.status(400).send("此行事曆連結已失效，請回到俐姐的家官方 LINE 查看最新預約狀態。");
  }
}
