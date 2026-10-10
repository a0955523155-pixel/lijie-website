import {requireAdmin} from "./admin-auth.js";
import {rescheduleConfirmedBooking} from "./firestore-admin.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store");
  if(req.method!=="POST")return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  try{const actor=await requireAdmin(req);const booking=await rescheduleConfirmedBooking(String(req.body?.bookingId||""),req.body||{},actor);return res.status(200).json({ok:true,booking});}
  catch(e){const error=String(e.message||e);return res.status(/AUTH/.test(error)?401:/FORBIDDEN/.test(error)?403:/FIRESTORE/.test(error)?503:409).json({ok:false,error});}
}
