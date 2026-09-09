import { autoSeasonMap, bookingWindowMaxDate } from "./holiday-market.js";
import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";
let cachedToken = null;
let cachedExp = 0;

function b64url(input){ return Buffer.from(input).toString("base64url"); }
function nowIso(){ return new Date().toISOString(); }

function credentials(){
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (v.project_id && v.client_email && v.private_key) return v;
    } catch {}
  }
  const project_id = process.env.FIREBASE_PROJECT_ID || "li-jie-s-home-official-website";
  const client_email = process.env.FIREBASE_CLIENT_EMAIL || "";
  const private_key = String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g,"\n");
  if (project_id && client_email && private_key) return { project_id, client_email, private_key };
  return null;
}

export function firestoreReady(){ return Boolean(credentials()); }
export function firestoreProjectId(){ return credentials()?.project_id || ""; }

async function accessToken(){
  if (cachedToken && Date.now() < cachedExp - 60_000) return cachedToken;
  const c = credentials();
  if (!c) throw new Error("FIRESTORE_NOT_CONFIGURED");
  const iat = Math.floor(Date.now()/1000), exp = iat + 3600;
  const header = b64url(JSON.stringify({ alg:"RS256", typ:"JWT" }));
  const claim = b64url(JSON.stringify({ iss:c.client_email, scope:SCOPE, aud:TOKEN_URL, iat, exp }));
  const unsigned = `${header}.${claim}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), c.private_key).toString("base64url");
  const assertion = `${unsigned}.${sig}`;
  const body = new URLSearchParams({ grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  const r = await fetch(TOKEN_URL,{ method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body });
  if(!r.ok) throw new Error(`FIRESTORE_AUTH_FAILED ${r.status} ${await r.text()}`);
  const j = await r.json();
  cachedToken = j.access_token; cachedExp = Date.now() + Number(j.expires_in||3600)*1000;
  return cachedToken;
}

function base(){
  const c=credentials();
  if(!c) throw new Error("FIRESTORE_NOT_CONFIGURED");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(c.project_id)}/databases/(default)/documents`;
}

function toValue(v){
  if(v === null || v === undefined) return { nullValue:null };
  if(typeof v === "string") return { stringValue:v };
  if(typeof v === "boolean") return { booleanValue:v };
  if(Number.isInteger(v)) return { integerValue:String(v) };
  if(typeof v === "number") return { doubleValue:v };
  if(v instanceof Date) return { timestampValue:v.toISOString() };
  if(Array.isArray(v)) return { arrayValue:{ values:v.map(toValue) } };
  if(typeof v === "object") return { mapValue:{ fields:toFields(v) } };
  return { stringValue:String(v) };
}
function toFields(obj){ return Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,toValue(v)])); }
function fromValue(v){
  if(!v) return null;
  if("stringValue" in v) return v.stringValue;
  if("integerValue" in v) return Number(v.integerValue);
  if("doubleValue" in v) return Number(v.doubleValue);
  if("booleanValue" in v) return Boolean(v.booleanValue);
  if("timestampValue" in v) return v.timestampValue;
  if("nullValue" in v) return null;
  if("arrayValue" in v) return (v.arrayValue.values||[]).map(fromValue);
  if("mapValue" in v) return fromFields(v.mapValue.fields||{});
  return null;
}
function fromFields(fields){ return Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,fromValue(v)])); }
function docIdFromName(name=""){ return String(name).split("/").pop(); }

async function authedFetch(url, options={}){
  const tok=await accessToken();
  const r=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${tok}`}});
  return r;
}

export async function putBooking(id, data){
  const url=`${base()}/bookings/${encodeURIComponent(id)}`;
  const r=await authedFetch(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields:toFields(data)})});
  if(!r.ok) throw new Error(`FIRESTORE_BOOKING_SAVE_FAILED ${r.status} ${await r.text()}`);
  return true;
}

export async function getBooking(id){
  const r=await authedFetch(`${base()}/bookings/${encodeURIComponent(id)}`);
  if(r.status===404) return null;
  if(!r.ok) throw new Error(`FIRESTORE_BOOKING_READ_FAILED ${r.status} ${await r.text()}`);
  const j=await r.json(); return { id, ...fromFields(j.fields||{}) };
}

export async function listBookingsByLineUser(lineUserId,limit=8){
  const uid=String(lineUserId||"").trim();
  if(!uid) return [];
  const c=credentials(); if(!c) throw new Error("FIRESTORE_NOT_CONFIGURED");
  const url=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(c.project_id)}/databases/(default)/documents:runQuery`;
  const query={ structuredQuery:{ from:[{collectionId:"bookings"}], where:{fieldFilter:{field:{fieldPath:"lineUserId"},op:"EQUAL",value:{stringValue:uid}}}, limit:Math.min(Math.max(Number(limit)||8,1),20) } };
  const r=await authedFetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(query)});
  if(!r.ok) throw new Error(`FIRESTORE_LINE_BOOKING_QUERY_FAILED ${r.status} ${await r.text()}`);
  const rows=await r.json();
  return rows.filter(x=>x.document).map(x=>({id:docIdFromName(x.document.name),...fromFields(x.document.fields||{})}))
    .sort((a,b)=>String(b.startDate||b.createdAt||"").localeCompare(String(a.startDate||a.createdAt||""))).slice(0,limit);
}

export async function listPendingBookings(limit=4){
  const c=credentials(); if(!c) throw new Error("FIRESTORE_NOT_CONFIGURED");
  const url=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(c.project_id)}/databases/(default)/documents:runQuery`;
  const query={ structuredQuery:{ from:[{collectionId:"bookings"}], where:{fieldFilter:{field:{fieldPath:"status"},op:"EQUAL",value:{stringValue:"pending"}}}, limit:Math.min(Math.max(limit*4,10),50) } };
  const r=await authedFetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(query)});
  if(!r.ok) throw new Error(`FIRESTORE_PENDING_QUERY_FAILED ${r.status} ${await r.text()}`);
  const rows=await r.json();
  return rows.filter(x=>x.document).map(x=>({id:docIdFromName(x.document.name),...fromFields(x.document.fields||{})}))
    .sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).slice(0,limit);
}

function dateRangeNights(ci,co){
  const out=[]; const cur=new Date(`${ci}T00:00:00Z`), end=new Date(`${co}T00:00:00Z`);
  while(cur<end){ out.push(cur.toISOString().slice(0,10)); cur.setUTCDate(cur.getUTCDate()+1); }
  return out;
}

export async function setBookingStatus(id,status){
  const b=await getBooking(id); if(!b) throw new Error("BOOKING_NOT_FOUND");
  const updated={...b,status,updatedAt:nowIso()};
  delete updated.id;
  if(status==="confirmed") updated.confirmedAt=nowIso();
  if(status==="cancelled") updated.cancelledAt=nowIso();
  await putBooking(id,updated);
  const days=dateRangeNights(b.startDate,b.endDate);
  if(status==="confirmed" && !b.isTest){
    // 正式訂單才鎖住宿日期；測試訂單不影響官網可預約狀態。
    // 先檢查所有住宿晚數，避免確認新訂單時覆蓋另一筆已確認預約。
    for(const day of days){
      const existing=await authedFetch(`${base()}/availability/${day}`);
      if(existing.status===404) continue;
      if(!existing.ok) throw new Error(`FIRESTORE_AVAILABILITY_READ_FAILED ${existing.status} ${await existing.text()}`);
      const j=await existing.json(); const d=fromFields(j.fields||{});
      if(d.status==="booked" && d.bookingId && d.bookingId!==id){
        throw new Error(`BOOKING_DATE_CONFLICT ${day} ${d.bookingId}`);
      }
    }
    for(const day of days){
      const r=await authedFetch(`${base()}/availability/${day}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields:toFields({status:"booked",bookingId:id,updatedAt:nowIso()})})});
      if(!r.ok) throw new Error(`FIRESTORE_AVAILABILITY_SAVE_FAILED ${r.status} ${await r.text()}`);
    }
  }
  if(status==="cancelled" && !b.isTest){
    for(const day of days){
      const url=`${base()}/availability/${day}`;
      const existing=await authedFetch(url);
      if(existing.status===404) continue;
      if(!existing.ok) throw new Error(`FIRESTORE_AVAILABILITY_READ_FAILED ${existing.status} ${await existing.text()}`);
      const j=await existing.json(); const d=fromFields(j.fields||{});
      if(d.bookingId===id){
        const del=await authedFetch(url,{method:"DELETE"});
        if(!del.ok && del.status!==404) throw new Error(`FIRESTORE_AVAILABILITY_DELETE_FAILED ${del.status} ${await del.text()}`);
      }
    }
  }
  return {id,...updated};
}

export async function getPricingConfig(){
  const r=await authedFetch(`${base()}/settings/pricing`);
  if(r.status===404) return null;
  if(!r.ok) throw new Error(`FIRESTORE_PRICING_READ_FAILED ${r.status} ${await r.text()}`);
  const j=await r.json(); return fromFields(j.fields||{});
}

function pricingNights(ci,co){
  const out=[]; const cur=new Date(`${ci}T00:00:00Z`), end=new Date(`${co}T00:00:00Z`);
  while(cur<end){ out.push(cur.toISOString().slice(0,10)); cur.setUTCDate(cur.getUTCDate()+1); }
  return out;
}
function inRange(day,start,end){ return Boolean(start&&end&&day>=start&&day<=end); }
export async function quoteStay(ci,co){
  const cfg=await getPricingConfig();
  if(!cfg || cfg.enabled===false) return null;
  const weekday=Number(cfg.weekdayPrice||0);
  const weekend=Number(cfg.weekendPrice||cfg.fridayPrice||cfg.saturdayPrice||0);
  if(!(weekday>0) || !(weekend>0)) return null;
  const specials=Array.isArray(cfg.specialRanges)?cfg.specialRanges:[];
  const nights=pricingNights(ci,co);
  const last=nights[nights.length-1]||ci;
  let auto=new Map();
  try{
    auto=await autoSeasonMap(ci,last,{government:cfg.autoGovernmentHolidays!==false,kenting:cfg.autoKentingEvents!==false});
  }catch(e){ console.warn('quoteStay auto season failed',String(e?.message||e)); }
  const holidayPrice=Number(cfg.holidayPrice||0);
  const eventPrice=Number(cfg.eventPrice||0);
  const details=nights.map(day=>{
    const special=specials.find(x=>x && inRange(day,String(x.startDate||''),String(x.endDate||'')) && Number(x.nightlyPrice)>0);
    if(special) return {date:day,label:String(special.label||'特殊假期'),price:Number(special.nightlyPrice),source:'manual-special'};
    const season=auto.get(day);
    const dow=new Date(`${day}T00:00:00Z`).getUTCDay();
    if(season?.type==='event' && eventPrice>0) return {date:day,label:season.label,price:eventPrice,source:'auto-event'};

    // 俐姐的家週日規則採「隔天週一是否放假」的明確判斷：
    // 一般週日永遠 NT$10,000；只有該週日的下一天（週一）確實是政府放假日，
    // 才允許 auto-holiday 覆蓋成政府連假價。這可避免週五～週日三天連假誤漲週日晚。
    if(dow===0){
      const monday=new Date(`${day}T00:00:00Z`); monday.setUTCDate(monday.getUTCDate()+1);
      const mondayKey=monday.toISOString().slice(0,10);
      if(season?.type==='holiday' && season.holidayDate===mondayKey && holidayPrice>0){
        return {date:day,label:season.label,price:holidayPrice,source:'auto-holiday-monday-off'};
      }
      return {date:day,label:'週日',price:10000,source:'sunday-fixed-rule'};
    }

    if(season?.type==='holiday' && holidayPrice>0) return {date:day,label:season.label,price:holidayPrice,source:'auto-holiday'};
    if(dow===5) return {date:day,label:'週五',price:weekend,source:'weekend-rule'};
    if(dow===6) return {date:day,label:'週六',price:weekend,source:'weekend-rule'};
    return {date:day,label:'平日',price:weekday,source:'weekday-rule'};
  });
  const total=details.reduce((sum,x)=>sum+Number(x.price||0),0);
  return {currency:'TWD',total,details,pricingUpdatedAt:cfg.updatedAt||null,bookingWindowMonths:Math.max(1,Math.min(Number(cfg.bookingWindowMonths)||6,18)),maxBookableDate:bookingWindowMaxDate(cfg.bookingWindowMonths||6)};
}

export async function getPublicPricingSettings(){
  const cfg=await getPricingConfig();
  if(!cfg) return {enabled:false,bookingWindowMonths:6,maxBookableDate:bookingWindowMaxDate(6)};
  const months=Math.max(1,Math.min(Number(cfg.bookingWindowMonths)||6,18));
  return {enabled:cfg.enabled!==false,bookingWindowMonths:months,maxBookableDate:bookingWindowMaxDate(months),autoGovernmentHolidays:cfg.autoGovernmentHolidays!==false,autoKentingEvents:cfg.autoKentingEvents!==false};
}

export async function firestoreDiagnostic(){
  if(!firestoreReady()) return {ready:false,projectId:firestoreProjectId()};
  try { await listPendingBookings(1); return {ready:true,projectId:firestoreProjectId(),readOk:true}; }
  catch(e){ return {ready:true,projectId:firestoreProjectId(),readOk:false,error:String(e?.message||e).slice(0,300)}; }
}
