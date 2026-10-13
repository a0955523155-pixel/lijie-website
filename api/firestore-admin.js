import { autoSeasonMap, bookingWindowMaxDate } from "./holiday-market.js";
import crypto from "node:crypto";
import { paymentReportPatch } from "./payment-report-state.js";
import {newConfirmationJobs,SETTINGS_PATH,stayKey,replaceStayReminderJobs,NOTIFICATION_KINDS,planChangeNotice,configuredReminderSettings} from "./housekeeping-notification-plan.js";

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
export async function adminExists(uid){
  if(!uid) return false;
  const r=await authedFetch(`${base()}/admins/${encodeURIComponent(uid)}`);
  if(r.status===404) return false;
  if(!r.ok) throw new Error(`FIRESTORE_ADMIN_READ_FAILED ${r.status} ${await r.text()}`);
  return true;
}

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

// Server-only operational records. Browser rules remain closed; callers must
// authorize the existing staff/admin identity before requesting these records.
export async function getPrivateRecord(path){
  const r=await authedFetch(`${base()}/${path}`);
  if(r.status===404)return null;
  if(!r.ok)throw new Error(`FIRESTORE_RECORD_READ_FAILED ${r.status}`);
  return fromFields((await r.json()).fields||{});
}
export async function listCollectionRecords(collection){
  const rows=[],seen=new Set();let pageToken="";
  do{
    const params=new URLSearchParams({pageSize:"500"});if(pageToken)params.set("pageToken",pageToken);
    const r=await authedFetch(`${base()}/${collection}?${params}`);
    if(!r.ok)throw new Error(`FIRESTORE_RECORD_LIST_FAILED ${r.status}`);
    const data=await r.json();rows.push(...(data.documents||[]).map(d=>({id:docIdFromName(d.name),...fromFields(d.fields||{})})));
    pageToken=data.nextPageToken||"";if(pageToken&&seen.has(pageToken))throw new Error("FIRESTORE_REPEATED_PAGE_TOKEN");seen.add(pageToken);
  }while(pageToken);
  return rows;
}


export async function listAllBookings(limit=500){
  const c=credentials(); if(!c) throw new Error("FIRESTORE_NOT_CONFIGURED");
  const max=Math.min(Math.max(Number(limit)||500,1),1000);
  const r=await authedFetch(`${base()}/bookings?pageSize=${max}`);
  if(!r.ok) throw new Error(`FIRESTORE_BOOKING_LIST_FAILED ${r.status} ${await r.text()}`);
  const j=await r.json();
  return (j.documents||[]).map(d=>({id:docIdFromName(d.name),...fromFields(d.fields||{})}));
}
// Read only this user's complete result before sorting, including legacy rows without
// createdAt. A single equality query needs no new composite index.
export async function listBookingsByLineUser(lineUserId,limit=Infinity){
  const uid=String(lineUserId||"").trim(); if(!uid)return [];
  const query={structuredQuery:{from:[{collectionId:"bookings"}],where:{fieldFilter:{field:{fieldPath:"lineUserId"},op:"EQUAL",value:{stringValue:uid}}}}};
  const r=await authedFetch(`${base()}:runQuery`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(query)});
  if(!r.ok)throw new Error(`FIRESTORE_LINE_BOOKING_QUERY_FAILED ${r.status} ${await r.text()}`);
  const rows=(await r.json()).filter(x=>x.document).map(x=>({id:docIdFromName(x.document.name),...fromFields(x.document.fields||{})})).filter(x=>x.lineUserId===uid);
  return sortCustomerBookings(rows).slice(0,limit);
}
export function sortCustomerBookings(rows,today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"})){
  const rank=b=>b.status!=="cancelled"&&String(b.endDate||b.startDate||"")>=today?0:b.status==="pending"?1:2;
  return [...rows].sort((a,b)=>rank(a)-rank(b)||(rank(a)===0?String(a.startDate||"").localeCompare(String(b.startDate||"")):String(b.createdAt||b.startDate||"").localeCompare(String(a.createdAt||a.startDate||"")))||String(a.id).localeCompare(String(b.id)));
}
export async function customerBookingsPage(uid,{page=1,size=3,activeOnly=false}={}){
  const all=(await listBookingsByLineUser(uid)).filter(b=>!activeOnly||b.status!=="cancelled");
  const pages=Math.max(1,Math.ceil(all.length/size)); page=Math.min(Math.max(1,Number(page)||1),pages);
  return {items:all.slice((page-1)*size,page*size),page,pages,total:all.length};
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

// REST transactions keep reads, date locks and state changes serializable. Retry
// only ABORTED; a transport failure may already have committed and is retried by
// the caller using the same booking/request/event identity.
export async function bookingTransaction(work){
  for(let attempt=0;attempt<5;attempt++){
    let transaction;
    try{
      const begun=await authedFetch(`${base()}:beginTransaction`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({options:{readWrite:{}}})});
      await assertFirestore(begun); transaction=(await begun.json()).transaction;
      const writes=[];
      const name=path=>`${base().replace("https://firestore.googleapis.com/v1/","")}/${path}`;
      const tx={
        async get(path){
          const r=await authedFetch(`${base()}/${path}?transaction=${encodeURIComponent(transaction)}`);
          if(r.status===404)return null; await assertFirestore(r);
          const d=await r.json();return fromFields(d.fields||{});
        },
        set(path,data,merge=false){const w={update:{name:name(path),fields:toFields(data)}};if(merge)w.updateMask={fieldPaths:Object.keys(data)};writes.push(w);},
        delete(path){writes.push({delete:name(path)});}
      };
      const result=await work(tx);
      const r=await authedFetch(`${base()}:commit`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({transaction,writes})});
      await assertFirestore(r);return result;
    }catch(e){
      if(transaction)await authedFetch(`${base()}:rollback`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({transaction})}).catch(()=>{});
      if(e.code!=="ABORTED"||attempt===4)throw e;
    }
  }
}
async function assertFirestore(r){
  if(r.ok)return;
  const detail=await r.json().catch(()=>({})); const e=new Error(`FIRESTORE_TRANSACTION_FAILED ${r.status} ${detail.error?.status||""}`);e.code=detail.error?.status;throw e;
}
function stayDays(start,end){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw new Error("INVALID_DATES");
  const span=(new Date(`${end}T00:00:00Z`)-new Date(`${start}T00:00:00Z`))/86400000;
  if(!Number.isInteger(span)||span<1||span>90)throw new Error("INVALID_DATES");
  const days=dateRangeNights(start,end);
  return days;
}
async function readStay(tx,b){
  const days=stayDays(b.startDate,b.endDate),states=[];
  for(const day of days)states.push(await tx.get(`availability/${day}`));
  return days.map((day,i)=>({day,state:states[i]}));
}
function checkStay(rows,id=""){
  for(const {day,state} of rows){
    if(state && state.status!=="available" && !(id&&state.status==="booked"&&state.bookingId===id))throw new Error(`BOOKING_DATE_CONFLICT ${day}`);
  }
}
export async function setBookingStatus(id,status){
  if(!['confirmed','cancelled','pending'].includes(status))throw new Error("INVALID_STATUS");
  return bookingTransaction(async tx=>{
    const path=`bookings/${encodeURIComponent(id)}`,b=await tx.get(path);if(!b)throw new Error("BOOKING_NOT_FOUND");
    if(status==="confirmed"&&b.status==="cancelled")throw new Error("BOOKING_CANCELLED");
    if(status==="confirmed"&&Math.max(Number(b.paidAmount)||0,Number(b.amountReceived)||0)<Number(b.depositRequired||3000))throw new Error("DEPOSIT_NOT_PAID");
    const rows=b.isTest?[]:await readStay(tx,b);
    if(status==="confirmed")checkStay(rows,id);
    const alreadyConfirmed=status==="confirmed"&&b.status==="confirmed";
    const settings=status==="confirmed"&&!alreadyConfirmed&&!b.isTest?configuredReminderSettings(await tx.get(SETTINGS_PATH)||{}):null;
    const notificationJobs=newConfirmationJobs({id,...b,status},settings);
    const existingJobs=await Promise.all(notificationJobs.map(job=>tx.get(`housekeepingNotifications/${job.id}`)));
    const patch={status,updatedAt:nowIso()};
    if(notificationJobs.length)patch.housekeepingNotificationActivationId=settings.activationId;
    if(status==="cancelled"){
      await planChangeNotice(tx,{id,...b},{id,...b,status},await tx.get(SETTINGS_PATH),"cancelled",new Date());
      const revision=stayKey({id,...b});
      const jobs=await Promise.all(NOTIFICATION_KINDS.filter(kind=>kind!=="cancelled").map(kind=>tx.get(`housekeepingNotifications/HN${revision}-${kind}`)));
      jobs.forEach((job,index)=>{if(job)tx.set(`housekeepingNotifications/HN${revision}-${NOTIFICATION_KINDS.filter(kind=>kind!=="cancelled")[index]}`,{...(job.status==="pending"?{status:"stale"}:{}),supersededAt:nowIso()},true);});
    }
    if(status==="confirmed")patch.confirmedAt=b.confirmedAt||nowIso();
    if(status==="cancelled")patch.cancelledAt=nowIso();
    notificationJobs.forEach((job,index)=>{if(!existingJobs[index])tx.set(`housekeepingNotifications/${job.id}`,job);});
    for(const {day,state} of rows){
      if(status==="confirmed")tx.set(`availability/${day}`,{status:"booked",bookingId:id,updatedAt:nowIso()});
      else if(state?.bookingId===id)tx.delete(`availability/${day}`);
    }
    tx.set(path,patch,true);return {id,...b,...patch,alreadyConfirmed};
  });
}
export async function rescheduleConfirmedBooking(id,input,actor,now=new Date()){
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(id))throw new Error("INVALID_ID");
  const {startDate,endDate,expectedStartDate,expectedEndDate}=input;
  for(const day of [startDate,endDate]){const date=new Date(`${day}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)throw new Error("INVALID_DATES");}
  const days=stayDays(startDate,endDate);if(!days.length)throw new Error("INVALID_DATES");
  const fields={};for(const key of ["guestName","phone","email","deposit","notes"]){if(key in input)fields[key]=String(input[key]).slice(0,key==="notes"?1000:200);}
  if("people" in input){const people=Number(input.people);if(!Number.isInteger(people)||people<1||people>12)throw new Error("INVALID_PEOPLE");fields.people=people;}
  const operation=crypto.createHash("sha256").update(JSON.stringify({id,startDate,endDate,expectedStartDate,expectedEndDate,fields})).digest("hex");
  return bookingTransaction(async tx=>{
    const b=await tx.get(`bookings/${id}`);if(!b)throw new Error("BOOKING_NOT_FOUND");if(b.status!=="confirmed")throw new Error("BOOKING_NOT_CONFIRMED");
    if(b.lastRescheduleOperation===operation)return {id,...b,duplicate:true};
    if(b.startDate!==expectedStartDate||b.endDate!==expectedEndDate)throw new Error("BOOKING_DATE_CHANGED");
    const changed=b.startDate!==startDate||b.endDate!==endDate;
    const oldDays=b.isTest?[]:stayDays(b.startDate,b.endDate),newDays=b.isTest?[]:days,all=[...new Set([...oldDays,...newDays])];
    const locks=await Promise.all(all.map(day=>tx.get(`availability/${day}`)));
    checkStay(all.map((day,index)=>({day,state:locks[index]})).filter(x=>newDays.includes(x.day)),id);
    const patch={...fields,startDate,endDate,updatedAt:now.toISOString(),rescheduledBy:actor.uid,lastRescheduleOperation:operation};
    if(changed){patch.housekeepingRevision=(Number(b.housekeepingRevision)||0)+1;await replaceStayReminderJobs(tx,{id,...b},{id,...b,...patch},await tx.get(SETTINGS_PATH),now);}
    for(let i=0;i<all.length;i++){const day=all[i];if(newDays.includes(day))tx.set(`availability/${day}`,{status:"booked",bookingId:id,updatedAt:now.toISOString()});else if(locks[i]?.bookingId===id)tx.delete(`availability/${day}`);}
    tx.set(`bookings/${id}`,patch,true);return {id,...b,...patch,duplicate:false};
  });
}
export async function createPendingBooking(id,data){
  return bookingTransaction(async tx=>{
    const path=`bookings/${encodeURIComponent(id)}`,existing=await tx.get(path);
    if(existing){
      if(existing.lineUserId!==data.lineUserId)throw new Error("BOOKING_LINE_MISMATCH");
      if(existing.requestFingerprint&&existing.requestFingerprint!==data.requestFingerprint)throw new Error("REQUEST_ID_REUSED");
      return {id,...existing,duplicate:true};
    }
    checkStay(await readStay(tx,data));
    tx.set(path,data);return {id,...data,duplicate:false};
  });
}
export async function savePaymentReport(id,info){
  return bookingTransaction(async tx=>{
    const path=`bookings/${encodeURIComponent(id)}`,b=await tx.get(path);if(!b)throw new Error("BOOKING_NOT_FOUND");
    const patch=paymentReportPatch(b,info,nowIso());
    if(patch)tx.set(path,patch,true);
    return {id,...b,...patch,duplicate:!patch||!patch.paymentReportedAt};
  });
}

// Customer service requests must not replace a stale copy of finance/status fields.
export async function saveServiceRequest(id,uid,patch){
  return bookingTransaction(async tx=>{
    const path=`bookings/${encodeURIComponent(id)}`,b=await tx.get(path);
    if(!b)throw new Error("BOOKING_NOT_FOUND");
    if(!uid||b.lineUserId!==uid)throw new Error("BOOKING_LINE_MISMATCH");
    if(patch.cancellationRequestStatus&&b.status==="cancelled")throw new Error("BOOKING_ALREADY_CANCELLED");
    tx.set(path,patch,true);return {id,...b,...patch};
  });
}

export async function recordCustomerNotification(id,notificationId,event){
  return bookingTransaction(async tx=>{
    const path=`bookings/${encodeURIComponent(id)}`,b=await tx.get(path);
    if(!b)throw new Error("BOOKING_NOT_FOUND");
    const patch={lastCustomerNotificationId:notificationId,lastCustomerNotificationEvent:event,lastCustomerNotificationAt:nowIso(),updatedAt:nowIso()};
    tx.set(path,patch,true);return {id,...b,...patch};
  });
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

    // 住宿夜價格規則：週日～週四為平日價；週五、週六為週末價。
    // 連續假期採「隔天是否為連假放假日」判斷，因此會自然把整段連假往前一晚套價：
    // 例如連假週五開始，週四晚即為連假價；若連假延續到週一，週日晚亦為連假價。
    if(season?.type==='holiday' && holidayPrice>0) return {date:day,label:season.label,price:holidayPrice,source:'auto-holiday-night-before'};
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
