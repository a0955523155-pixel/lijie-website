import { adminExists } from "./firestore-admin.js";
const FIREBASE_API_KEY=process.env.FIREBASE_WEB_API_KEY||"AIzaSyBx_R_gWT9nN-t8l7w-9fR6X0d2sS9-aIE";
export async function requireAdmin(req){
  const auth=String(req.headers.authorization||"");
  const token=auth.startsWith("Bearer ")?auth.slice(7).trim():"";
  if(!token) throw new Error("ADMIN_AUTH_REQUIRED");
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:token})});
  if(!r.ok) throw new Error("ADMIN_AUTH_INVALID");
  const j=await r.json(); const uid=j?.users?.[0]?.localId||"";
  if(!uid || !(await adminExists(uid))) throw new Error("ADMIN_FORBIDDEN");
  return {uid,email:j?.users?.[0]?.email||""};
}
