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
function esc(v=""){
  return String(v).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[c]));
}
function makeIcs(p){
  const uid=`${p.id}@5-1bbs.com`;
  const now=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  const title="俐姐的家｜住宿預約";
  const desc=`預約編號：${p.id}\\n姓名：${p.n||"未填"}\\n入住 15:00 起／退房 12:00 前\\n如有行程異動，請透過俐姐的家官方 LINE 聯繫。`;
  return [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Lijie's Home//Booking Calendar//ZH-TW",
    "CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",`UID:${icsEscape(uid)}`,`DTSTAMP:${now}`,
    `DTSTART;TZID=Asia/Taipei:${dateTime(p.ci,"150000")}`,`DTEND;TZID=Asia/Taipei:${dateTime(p.co,"120000")}`,
    `SUMMARY:${icsEscape(title)}`,`DESCRIPTION:${icsEscape(desc)}`,"STATUS:CONFIRMED","BEGIN:VALARM",
    "TRIGGER:-P1D","ACTION:DISPLAY","DESCRIPTION:明天入住俐姐的家","END:VALARM","END:VEVENT","END:VCALENDAR",""
  ].join("\r\n");
}
function googleUrl(p){
  const q=new URLSearchParams({
    action:"TEMPLATE",
    text:"俐姐的家｜住宿預約",
    dates:`${dateTime(p.ci,"150000")}/${dateTime(p.co,"120000")}`,
    ctz:"Asia/Taipei",
    details:`預約編號：${p.id}\n姓名：${p.n||"未填"}\n入住 15:00 起／退房 12:00 前\n如有行程異動，請透過俐姐的家官方 LINE 聯繫。`
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).send("Method Not Allowed");
  try{
    if(!actionSecret()) throw new Error("SERVER_NOT_CONFIGURED");
    const token=String(req.query?.token||"");
    const p=verifyActionToken(token);
    if(String(req.query?.format||"").toLowerCase()==="ics"){
      const ics=makeIcs(p);
      res.setHeader("Content-Type","text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition",`attachment; filename="lijie-home-${String(p.id).replace(/[^A-Za-z0-9_-]/g,"")}.ics"`);
      res.setHeader("Cache-Control","private, no-store, max-age=0");
      return res.status(200).send(ics);
    }

    const g=googleUrl(p);
    const icsUrl=`https://www.5-1bbs.com/api/booking-calendar?format=ics&token=${encodeURIComponent(token)}`;
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","private, no-store, max-age=0");
    return res.status(200).send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>加入行事曆｜俐姐的家</title><style>
      :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f0e7;color:#173a35;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","PingFang TC",sans-serif}.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px 18px}.card{width:min(520px,100%);background:#fff;border-radius:26px;overflow:hidden;box-shadow:0 18px 55px rgba(20,50,45,.14)}.hero{padding:28px 24px 24px;background:linear-gradient(145deg,#123b34,#1e5046);color:#fff}.brand{font-size:12px;letter-spacing:.18em;color:#d6c59a;font-weight:700}.hero h1{margin:8px 0 4px;font-size:27px}.hero p{margin:0;color:#dce7e3}.body{padding:24px}.date{padding:17px 18px;border:1px solid #e7e0d4;border-radius:18px;margin-bottom:14px}.label{font-size:13px;color:#7a8580;margin-bottom:5px}.value{font-size:24px;font-weight:750}.time{font-size:14px;color:#57645f;margin-top:4px}.meta{font-size:14px;color:#66736e;margin:18px 2px}.btn{display:block;text-decoration:none;text-align:center;padding:15px 16px;border-radius:14px;font-weight:750;margin-top:11px}.google{background:#173a35;color:#fff}.apple{background:#f2ede3;color:#173a35;border:1px solid #dfd5c2}.hint{margin:18px 4px 2px;font-size:13px;line-height:1.65;color:#7a8580}.badge{display:inline-block;background:#edf5f2;color:#245a4e;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;margin-bottom:14px}</style></head><body><main class="wrap"><section class="card"><div class="hero"><div class="brand">LIJIE'S HOME</div><h1>加入住宿行事曆</h1><p>預約已確認，將住宿日期加入您的行事曆。</p></div><div class="body"><span class="badge">✓ 已確認預約</span><div class="date"><div class="label">入住</div><div class="value">${esc(p.ci)}</div><div class="time">15:00 起</div></div><div class="date"><div class="label">退房</div><div class="value">${esc(p.co)}</div><div class="time">12:00 前</div></div><div class="meta">預約編號｜${esc(p.id)}${p.n?`<br>姓名｜${esc(p.n)}`:""}</div><a class="btn google" href="${esc(g)}" target="_blank" rel="noopener">加入 Google 行事曆</a><a class="btn apple" href="${esc(icsUrl)}">iPhone / Apple 行事曆</a><div class="hint">若您在 LINE 內建瀏覽器點 Apple 行事曆沒有跳出加入畫面，請點右上角選單改用 Safari／瀏覽器開啟，再按一次即可。LINE 行事曆若已同步手機行事曆，也會一起顯示。</div></div></section></main></body></html>`);
  }catch(e){
    console.error("booking calendar error",e);
    return res.status(400).send("此行事曆連結已失效，請回到俐姐的家官方 LINE 查看最新預約狀態。");
  }
}
