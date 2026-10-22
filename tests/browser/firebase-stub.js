const state=()=>window.__fake;
const ref=(collection,id)=>({collection,id});
const rows=col=>state()[col]||(state()[col]=[]);
const value=r=>r.collection==='admins'?(state().adminDenied?undefined:{authorized:true}):rows(r.collection).find(x=>x.id===r.id);
const snap=r=>({id:r.id,ref:r,exists:()=>Boolean(value(r)),data:()=>value(r)});
const save=(r,data,options)=>{state().writes.push({ref:r,data});const list=rows(r.collection),i=list.findIndex(x=>x.id===r.id);const v={id:r.id,...(options?.merge&&i>=0?list[i]:{}),...data};if(i<0)list.push(v);else list[i]=v;};
const check=async()=>{if(state().failWrites)throw new Error('SYNTHETIC_SAVE_FAILURE');if(state().slowWrites)await new Promise(r=>setTimeout(r,100));};
export const initializeApp=()=>({});export const getApps=()=>[];export const getFirestore=()=>({});export const getStorage=()=>({});
export const getAuth=()=>({currentUser:state().authNone?null:{uid:state().authUid||'synthetic-admin',email:state().authEmail||'test@example.invalid',getIdToken:async()=> 'FAKE'}});
export const onAuthStateChanged=(auth,cb)=>setTimeout(()=>cb(auth.currentUser),0);
export const setPersistence=async()=>{};export const browserSessionPersistence={};export const browserLocalPersistence={};
export const signInWithEmailAndPassword=async()=>{};export const signOut=async()=>{};
export const collection=(db,col)=>ref(col);export const doc=(db,col,id)=>typeof col==='string'?ref(col,id):ref(db.collection,crypto.randomUUID());
export const getDoc=async r=>snap(r);
export const where=(field,op,value)=>({field,op,value});export const documentId=()=> '__id';export const orderBy=(orderField,direction='asc')=>({orderField,direction});export const limit=count=>({count});
export const query=(col,...filters)=>({...col,filters});
export const getDocs=async q=>{
  if(q.collection==='inventoryItems'&&state().failInventoryRefresh){throw Object.assign(new Error('SYNTHETIC_INVENTORY_READ_FAILURE'),{code:'unavailable'});}
  if(q.collection==='bookings'&&state().failReadAfterPayment&&rows('paymentTransactions').length){state().failReadAfterPayment=false;throw new Error('SYNTHETIC_REFRESH_FAILURE');}
  if(q.collection==='availability'&&state().failCalendar)throw new Error('SYNTHETIC_CALENDAR_OFFLINE');
  let list=rows(q.collection);
  for(const f of q.filters||[])if(f.field)list=list.filter(x=>{const v=f.field==='__id'?x.id:x[f.field];return f.op==='=='?v===f.value:f.op==='>='?v>=f.value:v<=f.value;});
  for(const f of q.filters||[])if(f.orderField)list=[...list].filter(x=>x[f.orderField]!==undefined).sort((a,b)=>String(a[f.orderField]).localeCompare(String(b[f.orderField]))*(f.direction==='desc'?-1:1));
  for(const f of q.filters||[])if(f.count)list=list.slice(0,f.count);
  const docs=list.map(x=>snap(ref(q.collection,x.id)));
  return {docs,forEach:cb=>docs.forEach(cb),empty:!docs.length};
};
export const getDocsFromServer=getDocs;
export const setDoc=async(r,v,o)=>{await check();save(r,v,o);};
export const deleteDoc=async r=>{state().deleteCalls=(state().deleteCalls||0)+1;await check();if(state().deleteCode)throw Object.assign(new Error('SYNTHETIC_DELETE_FAILURE'),{code:state().deleteCode});state()[r.collection]=rows(r.collection).filter(x=>x.id!==r.id);if(state().failReadAfterDelete)state().failInventoryRefresh=true;};
export const serverTimestamp=()=> 'synthetic-timestamp';
export const writeBatch=()=>{const writes=[];return {set:(...args)=>writes.push(['set',args]),delete:r=>writes.push(['delete',[r]]),commit:async()=>{await check();for(const [kind,args]of writes)if(kind==='set')save(...args);else state()[args[0].collection]=rows(args[0].collection).filter(x=>x.id!==args[0].id);}};};
export const runTransaction=async(db,fn)=>{
  for(let attempt=0;attempt<5;attempt++){
    const reads=[],writes=[];
    const result=await fn({
      get:async r=>{const data=structuredClone(value(r));reads.push([r,JSON.stringify(data)]);return {id:r.id,ref:r,exists:()=>Boolean(data),data:()=>data};},
      set:(...args)=>writes.push(args),delete:()=>{throw new Error('Synthetic transaction does not implement deletes');}
    });
    await check();
    if(state().transactionCode)throw Object.assign(new Error('SYNTHETIC_TRANSACTION_FAILURE'),{code:state().transactionCode});
    if(reads.some(([r,before])=>JSON.stringify(value(r))!==before))continue;
    for(const args of writes)save(...args);
    if(state().loseTransactionReply){state().loseTransactionReply=false;throw Object.assign(new Error('SYNTHETIC_LOST_REPLY'),{code:'unavailable'});}
    return result;
  }throw Object.assign(new Error('SYNTHETIC_CONFLICT'),{code:'aborted'});
};
export const refStorage=()=>({});export { refStorage as ref };export const uploadBytes=async()=>{};export const getDownloadURL=async()=> '';
