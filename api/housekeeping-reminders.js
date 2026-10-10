import crypto from "node:crypto";
import {runHousekeepingReminders} from "./housekeeping-notifier.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET")return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  const secret=String(process.env.CRON_SECRET||""),provided=String(req.headers.authorization||"");
  if(!secret||process.env.HOUSEKEEPING_REMINDER_SCHEDULE_READY!=="true")return res.status(503).json({error:"REMINDER_SCHEDULE_NOT_CONFIGURED"});
  const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(provided);if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return res.status(401).json({error:"AUTH_REQUIRED"});
  try{return res.status(200).json(await runHousekeepingReminders());}catch{return res.status(503).json({error:"REMINDER_RUN_FAILED"});}
}
