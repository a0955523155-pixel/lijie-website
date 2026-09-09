import { quoteStay, getPublicPricingSettings, firestoreReady } from './firestore-admin.js';

function validDate(v){ return /^\d{4}-\d{2}-\d{2}$/.test(String(v||'')); }
function addDays(key,n){ const d=new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function monthBounds(month){
  if(!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y,m]=month.split('-').map(Number); const first=`${y}-${String(m).padStart(2,'0')}-01`;
  const next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10); return {first,next};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','public, max-age=0, s-maxage=1800, stale-while-revalidate=3600');
  if(req.method!=='GET'){ res.setHeader('Allow','GET'); return res.status(405).json({ok:false,error:'Method Not Allowed'}); }
  try{
    const settings=await getPublicPricingSettings();
    if(!firestoreReady()) return res.status(503).json({ok:false,error:'Pricing unavailable'});
    const month=String(req.query?.month||''); const start=String(req.query?.start||''); const end=String(req.query?.end||'');
    let ci,co;
    if(month){ const b=monthBounds(month); if(!b) return res.status(400).json({ok:false,error:'Invalid month'}); ci=b.first; co=b.next; }
    else { if(!validDate(start)||!validDate(end)||end<=start) return res.status(400).json({ok:false,error:'Invalid dates'}); ci=start; co=end; }
    const quote=await quoteStay(ci,co);
    return res.status(200).json({ok:true,settings,quote});
  }catch(e){ console.error('public-pricing-calendar',e); return res.status(500).json({ok:false,error:'Unable to load pricing'}); }
}
