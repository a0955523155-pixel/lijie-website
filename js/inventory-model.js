// Shared by admin and housekeeping. No booking-driven deductions or implicit classification.
export const INVENTORY_TYPES = {asset:'設備資產',consumable:'消耗品',linen:'送洗布品'};
export const STATES = {inUse:'在用',spare:'備用',repair:'維修',retired:'報廢',clean:'乾淨',inRoom:'房內使用',dirty:'待洗',laundry:'送洗中'};
export const STATE_KEYS = {asset:['inUse','spare','repair','retired'],linen:['clean','inRoom','dirty','laundry','retired']};
export function inventoryType(item){return Object.hasOwn(INVENTORY_TYPES,item.inventoryType)?item.inventoryType:'unclassified';}
export function nonnegative(value,label='數量'){
  const n=Number(value);if(value===''||value==null||!Number.isFinite(n)||n<0||n>1e9)throw new Error(`${label}必須是 0 到 10 億之間的數字。`);return n;
}
const round=n=>Math.round(n*1e6)/1e6;
export function countsFor(item){
  const type=inventoryType(item),keys=STATE_KEYS[type];if(!keys)return null;
  const counts={};for(const key of keys){counts[key]=nonnegative(item.stateCounts?.[key],STATES[key]);if(!Number.isInteger(counts[key]))throw new Error('設備與布品數量必須是整數。');}
  const active=keys.filter(k=>k!=='retired').reduce((s,k)=>s+counts[k],0);
  if(active!==nonnegative(item.quantity))throw new Error('狀態數量與總數不一致，請先核對資料。');return counts;
}
export function classifyInventory(item,type,initialState){
  if(inventoryType(item)!=='unclassified')throw new Error('已分類備品不可直接切換類型。');
  if(!Object.hasOwn(INVENTORY_TYPES,type))throw new Error('請明確選擇備品類型。');
  const quantity=nonnegative(item.quantity);
  if(type==='consumable')return {inventoryType:type};
  if(!Number.isInteger(quantity)||!STATE_KEYS[type].includes(initialState)||initialState==='retired')throw new Error('請選擇起始狀態；設備與布品數量必須是整數。');
  return {inventoryType:type,stateCounts:Object.fromEntries(STATE_KEYS[type].map(k=>[k,k===initialState?quantity:0]))};
}
export function movementOptions(item){
  const type=inventoryType(item);
  if(type==='consumable')return [{id:'in',label:'進貨'},{id:'out',label:'領用／消耗'}];
  if(type==='asset')return [
    {id:'receive',label:'增加同批備用設備（不同購入日請另建）',to:'spare'},
    ...['inUse','spare','repair'].flatMap(from=>['inUse','spare','repair','retired'].filter(to=>to!==from).map(to=>({id:`${from}:${to}`,label:`${STATES[from]} → ${STATES[to]}`,from,to})))
  ];
  if(type==='linen')return [{id:'receive',label:'購入／增加乾淨布品',to:'clean'},
    ...[['clean','inRoom'],['inRoom','dirty'],['dirty','laundry'],['laundry','clean']].map(([from,to])=>({id:`${from}:${to}`,label:`${STATES[from]} → ${STATES[to]}${from==='laundry'?'（可部分回件）':''}`,from,to})),
    ...['clean','inRoom','dirty','laundry'].map(from=>({id:`${from}:retired`,label:`${STATES[from]} → 報廢`,from,to:'retired'}))];
  return [];
}
export function applyMovement(item,input){
  const type=inventoryType(item),action=movementOptions(item).find(x=>x.id===input.action);
  if(!action)throw new Error('請先分類備品並選擇該類型可用的動作。');
  if(!item.unit?.trim()||input.unit!==item.unit)throw new Error('單位已變更，請重新整理後核對；交易不提供單位換算。');
  const qty=nonnegative(input.quantity);if(qty<=0)throw new Error('數量必須大於 0。');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||Number.isNaN(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date)throw new Error('請填寫有效日期。');
  const before=nonnegative(item.quantity);let after,patch,beforeStates=null,afterStates=null;
  if(type==='consumable'){
    if(input.action==='out'&&qty>before)throw new Error('庫存不足，不能扣成負數。');
    after=round(before+(input.action==='in'?qty:-qty));if(after<0)throw new Error('庫存不足，不能扣成負數。');patch={quantity:after};
  }else{
    if(!Number.isInteger(qty))throw new Error('設備與布品數量必須是整數。');
    beforeStates=countsFor(item);afterStates={...beforeStates};
    if(action.to==='retired'&&!input.note?.trim())throw new Error('報廢請填寫原因，保留汰換歷史。');
    if(action.from){if(afterStates[action.from]<qty)throw new Error(`${STATES[action.from]}數量不足。`);afterStates[action.from]-=qty;}
    afterStates[action.to]+=qty;
    for(const key of STATE_KEYS[type])nonnegative(afterStates[key],STATES[key]);
    after=STATE_KEYS[type].filter(k=>k!=='retired').reduce((s,k)=>s+afterStates[k],0);
    patch={quantity:after,stateCounts:afterStates};
  }
  nonnegative(after);
  return {patch,history:{inventoryType:type,type:input.action,actionLabel:action.label,quantity:qty,unit:item.unit,beforeQuantity:before,afterQuantity:after,beforeStates,afterStates,from:action.from||null,to:action.to||null,date:input.date,note:input.note||'',location:item.location||'',purchasedDate:item.purchasedDate||''}};
}
export function inventorySummary(item){
  const type=inventoryType(item);
  if(type==='unclassified')return '待分類：請核對後手動分類';
  if(type==='consumable')return `安全庫存 ${Number(item.minQuantity)||0} ${item.unit||''}`;
  try{const counts=countsFor(item);return STATE_KEYS[type].map(k=>`${STATES[k]} ${counts[k]} ${item.unit||''}`).join('・');}catch(e){return e.message;}
}
export function lowInventory(item){return inventoryType(item)==='consumable'&&Number(item.quantity)<=Number(item.minQuantity||0);}
export function inventoryError(error,action='儲存'){
  const code=error?.code||'unknown',short=code.replace(/^firestore\//,'');
  if(short==='permission-denied')return `${action}未獲授權（${code}）。請核對目前登入帳號的管理員資格及已發布規則。`;
  if(['unavailable','deadline-exceeded','network-request-failed'].includes(short))return `${action}結果尚無法確認（${code}），請檢查網路並重新整理核對。`;
  return `${action}未完成（${code}）：${error?.message||'請重試。'}`;
}
