import { firebaseConfig } from "../js/config.js";

const FIREBASE_API_KEY=process.env.FIREBASE_WEB_API_KEY||firebaseConfig.apiKey||"";
const HOUSEKEEPING_EMAIL=String(process.env.HOUSEKEEPING_EMAIL||"51bbsadmin@gmail.com").trim().toLowerCase();

export async function requireHousekeeping(req){
  const auth=String(req.headers.authorization||"");
  const token=auth.startsWith("Bearer ")?auth.slice(7).trim():"";
  if(!token) throw new Error("HOUSEKEEPING_AUTH_REQUIRED");
  if(!FIREBASE_API_KEY) throw new Error("HOUSEKEEPING_FIREBASE_KEY_MISSING");
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:token})
  });
  if(!r.ok) throw new Error("HOUSEKEEPING_AUTH_INVALID");
  const j=await r.json();
  const user=j?.users?.[0];
  const email=String(user?.email||"").trim().toLowerCase();
  if(!user?.localId || email!==HOUSEKEEPING_EMAIL) throw new Error("HOUSEKEEPING_FORBIDDEN");
  return {uid:user.localId,email};
}
