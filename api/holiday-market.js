const DAY_MS = 86400000;
const NTPC_CALENDAR_URL = 'https://data.ntpc.gov.tw/api/datasets/308dcd75-6434-45bc-a95f-584da4fed251/json';
const PINGTUNG_FESTIVAL_URL = 'https://www.i-pingtung.com/ptfestival';

let cache = { at: 0, holidays: [], pingtungAnnualOk: false };
const CACHE_MS = 6 * 60 * 60 * 1000;

function dateKey(date) { return date.toISOString().slice(0,10); }
function parseDate(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 8) {
    const y=Number(digits.slice(0,4)), m=Number(digits.slice(4,6)), d=Number(digits.slice(6,8));
    const dt=new Date(Date.UTC(y,m-1,d));
    if(dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d) return dt;
  }
  const m = raw.match(/(20\d{2})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3])));
  return null;
}
function isHolidayRow(row={}) {
  const val = String(row.isholiday ?? row.isHoliday ?? row['是否放假'] ?? row.chinese ?? '').trim().toLowerCase();
  return ['2','true','是','yes','y'].includes(val);
}
function nameOf(row={}) {
  return String(row.name ?? row['節日'] ?? row['中文欄位'] ?? row.holidaycategory ?? row.holidayCategory ?? row.description ?? row['備註'] ?? '').trim();
}
function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates=[payload?.data,payload?.result?.records,payload?.records,payload?.response?.data,payload?.items];
  return candidates.find(Array.isArray) || [];
}
function clusterHolidayDates(rows) {
  const all = rows.filter(isHolidayRow).map(row=>({date:parseDate(row.date ?? row['日期']),name:nameOf(row)})).filter(x=>x.date).sort((a,b)=>a.date-b.date);
  const clusters=[]; let cur=[];
  for (const item of all) {
    if(!cur.length || item.date - cur[cur.length-1].date === DAY_MS) cur.push(item);
    else { clusters.push(cur); cur=[item]; }
  }
  if(cur.length) clusters.push(cur);
  return clusters;
}
function holidayLabel(cluster) {
  const names = cluster.map(x=>x.name).join(' ');
  const rules=[['春節','春節連假'],['清明','清明連假'],['兒童','清明連假'],['端午','端午連假'],['中秋','中秋連假'],['國慶','國慶連假'],['雙十','國慶連假'],['元旦','元旦連假'],['和平','228連假']];
  for(const [needle,label] of rules) if(names.includes(needle)) return label;
  return '連續假期';
}
async function fetchJson(url) {
  const controller=new AbortController(); const id=setTimeout(()=>controller.abort(),7000);
  try { const r=await fetch(url,{headers:{'User-Agent':'LijiesHomeCalendar/1.0'},signal:controller.signal}); if(!r.ok) throw new Error(`HTTP_${r.status}`); return await r.json(); }
  finally { clearTimeout(id); }
}
async function fetchText(url) {
  const controller=new AbortController(); const id=setTimeout(()=>controller.abort(),7000);
  try { const r=await fetch(url,{headers:{'User-Agent':'LijiesHomeCalendar/1.0'},signal:controller.signal}); if(!r.ok) throw new Error(`HTTP_${r.status}`); return await r.text(); }
  finally { clearTimeout(id); }
}
async function refresh() {
  if(Date.now()-cache.at < CACHE_MS) return cache;
  let holidays=[]; let pingtungAnnualOk=false;
  try { const payload=await fetchJson(NTPC_CALENDAR_URL); holidays=rowsFromPayload(payload); }
  catch(e){ console.warn('holiday-market ntpc fetch failed', String(e?.message||e)); }
  try { const html=await fetchText(PINGTUNG_FESTIVAL_URL); pingtungAnnualOk=/台灣祭/.test(html) && /4月|四月/.test(html); }
  catch(e){ console.warn('holiday-market pingtung fetch failed', String(e?.message||e)); }
  cache={at:Date.now(),holidays,pingtungAnnualOk}; return cache;
}

export async function autoSeasonMap(startKey,endKey,{government=true,kenting=true}={}) {
  const out=new Map();
  const {holidays,pingtungAnnualOk}=await refresh();
  if(government && holidays.length){
    for(const cluster of clusterHolidayDates(holidays)){
      // 一般週末不視為「連續假期」；至少三天才套連假價。
      if(cluster.length<3) continue;
      const label=holidayLabel(cluster);
      for(const item of cluster){ const k=dateKey(item.date); if(k>=startKey&&k<=endKey) out.set(k,{type:'holiday',label}); }
    }
  }
  if(kenting){
    // 跨年固定旺季：12/31 與 1/1。
    const start=new Date(`${startKey}T00:00:00Z`), end=new Date(`${endKey}T00:00:00Z`);
    for(let d=new Date(start); d<=end; d=new Date(d.getTime()+DAY_MS)){
      const md=`${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      if(md==='12-31'||md==='01-01') out.set(dateKey(d),{type:'event',label:'跨年旺季'});
    }
    // 屏東旅遊網將台灣祭列為「每年4月連假於墾丁大灣」；有抓到官方年曆描述時，
    // 直接把四月的政府連假標成台灣祭旺季，避免硬編每年日期。
    if(pingtungAnnualOk && holidays.length){
      for(const cluster of clusterHolidayDates(holidays)){
        if(cluster.length<3 || cluster[0].date.getUTCMonth()!==3) continue;
        for(const item of cluster){ const k=dateKey(item.date); if(k>=startKey&&k<=endKey) out.set(k,{type:'event',label:'台灣祭旺季'}); }
      }
    }
  }
  return out;
}

export function bookingWindowMaxDate(months=6, now=new Date()){
  const local=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const max=new Date(local); max.setMonth(max.getMonth()+Math.max(1,Math.min(Number(months)||6,18)));
  return `${max.getFullYear()}-${String(max.getMonth()+1).padStart(2,'0')}-${String(max.getDate()).padStart(2,'0')}`;
}
