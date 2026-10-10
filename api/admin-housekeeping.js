import crypto from "node:crypto";
import {requireAdmin} from "./admin-auth.js";
import {bookingTransaction,getPrivateRecord,listCollectionRecords} from "./firestore-admin.js";
import {reminderSettings,SETTINGS_PATH} from "./housekeeping-notification-plan.js";
import {gmailReady} from "./gmail-mailer.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  try{
    const actor=await requireAdmin(req),schedulerConfigured=Boolean(process.env.CRON_SECRET&&process.env.HOUSEKEEPING_REMINDER_SCHEDULE_READY==="true");
    if(req.method==="GET"){
      const settings=await getPrivateRecord(SETTINGS_PATH)||reminderSettings(),month=String(req.query?.month||"");if(!/^\d{4}-\d{2}$/.test(month))throw new Error("INVALID_MONTH");
      const reports=(await listCollectionRecords("housekeepingReports")).filter(x=>x.checkoutDate.startsWith(month)).sort((a,b)=>b.completedAt.localeCompare(a.completedAt));
      return res.status(200).json({ok:true,settings,gmailConfigured:gmailReady(),schedulerConfigured,reports});
    }
    const settings=reminderSettings(req.body||{});
    if(req.body?.activate===true){if(!schedulerConfigured||!gmailReady()||!settings.ready)throw new Error("REMINDER_NOT_READY");settings.enabled=true;settings.activationId=crypto.randomUUID();settings.activatedAt=new Date().toISOString();}
    await bookingTransaction(async tx=>{await tx.get(SETTINGS_PATH);tx.set(SETTINGS_PATH,{...settings,updatedBy:actor.uid,updatedAt:new Date().toISOString()});});
    return res.status(200).json({ok:true,settings,schedulerConfigured,gmailConfigured:gmailReady()});
  }catch(e){const code=String(e.message||e),status=/AUTH/.test(code)?401:/FORBIDDEN/.test(code)?403:/FIRESTORE/.test(code)?503:400;return res.status(status).json({ok:false,error:code});}
}
