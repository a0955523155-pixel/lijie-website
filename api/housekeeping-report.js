import {requireHousekeepingOrAdmin,completeHousekeeping,housekeepingError} from "./housekeeping-records.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store");
  if(req.method!=="POST")return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  try{const actor=await requireHousekeepingOrAdmin(req);return res.status(200).json({ok:true,report:await completeHousekeeping(req.body||{},actor)});}
  catch(e){return housekeepingError(res,e);}
}
