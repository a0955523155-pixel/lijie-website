import {requireHousekeepingOrAdmin,uploadHousekeepingPhoto,readHousekeepingPhoto,housekeepingError} from "./housekeeping-records.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  try{
    const actor=await requireHousekeepingOrAdmin(req);
    if(req.method==="POST")return res.status(200).json({ok:true,...await uploadHousekeepingPhoto(req.body||{},actor)});
    const photo=await readHousekeepingPhoto(req.query?.id);
    res.setHeader("Content-Type","image/jpeg");res.setHeader("Content-Disposition","inline; filename=\"housekeeping-confirmation.jpg\"");
    return res.status(200).send(Buffer.from(photo.base64,"base64"));
  }catch(e){return housekeepingError(res,e);}
}
