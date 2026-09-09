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
  if(status==="confirmed"){
    for(const day of days){
      const r=await authedFetch(`${base()}/availability/${day}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields:toFields({status:"booked",bookingId:id,updatedAt:nowIso()})})});
      if(!r.ok) throw new Error(`FIRESTORE_AVAILABILITY_SAVE_FAILED ${r.status} ${await r.text()}`);
    }
  }
  if(status==="cancelled"){
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

export async function firestoreDiagnostic(){
  if(!firestoreReady()) return {ready:false,projectId:firestoreProjectId()};
  try { await listPendingBookings(1); return {ready:true,projectId:firestoreProjectId(),readOk:true}; }
  catch(e){ return {ready:true,projectId:firestoreProjectId(),readOk:false,error:String(e?.message||e).slice(0,300)}; }
}
