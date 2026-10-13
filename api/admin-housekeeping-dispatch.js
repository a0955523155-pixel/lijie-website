import {requireAdmin} from "./admin-auth.js";
import {triggerHousekeepingBooking} from "./housekeeping-notifier.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store");
  if(req.method!=="POST")return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  try{await requireAdmin(req);const id=String(req.body?.bookingId||"");if(!/^[A-Za-z0-9_-]{1,120}$/.test(id))throw new Error("INVALID_ID");return res.status(200).json({ok:true,...await triggerHousekeepingBooking(id)});}
  catch(e){const error=String(e.message||e);return res.status(/AUTH/.test(error)?401:/FORBIDDEN/.test(error)?403:400).json({error});}
}
