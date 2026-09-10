import { requireHousekeeping } from "./housekeeping-auth.js";
import { listAllBookings } from "./firestore-admin.js";

function json(res,status,body){res.status(status).setHeader("Content-Type","application/json; charset=utf-8").send(JSON.stringify(body));}
function monthRange(month){
  if(!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y,m]=month.split("-").map(Number); if(m<1||m>12)return null;
  const start=`${month}-01`;
  const next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
  return {start,next};
}
export default async function handler(req,res){
  if(req.method!=="GET") return json(res,405,{error:"METHOD_NOT_ALLOWED"});
  try{
    await requireHousekeeping(req);
    const month=String(req.query?.month||""); const range=monthRange(month);
    if(!range) return json(res,400,{error:"INVALID_MONTH"});
    const rows=(await listAllBookings(600))
      .filter(b=>!b.isTest && b.status!=="cancelled")
      .filter(b=>String(b.startDate||"")<range.next && String(b.endDate||"")>range.start)
      .map(b=>({
        id:b.id,
        guestName:String(b.guestName||"未填姓名"),
        phone:String(b.phone||""),
        startDate:String(b.startDate||""),
        endDate:String(b.endDate||""),
        people:Number(b.people)||0,
        status:b.status==="confirmed"?"confirmed":"pending",
        notes:String(b.notes||b.housekeepingNote||"")
      }))
      .sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.guestName.localeCompare(b.guestName,"zh-Hant"));
    return json(res,200,{month,bookings:rows});
  }catch(e){
    const code=String(e?.message||e);
    const status=code.includes("AUTH")?401:code.includes("FORBIDDEN")?403:500;
    return json(res,status,{error:code});
  }
}
