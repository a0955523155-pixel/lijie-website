import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMovement,classifyInventory,inventoryType,inventorySummary,movementOptions,lowInventory,nonnegative,inventoryError} from '../js/inventory-model.js';
const base={name:'合成備品',quantity:10,unit:'件',minQuantity:2};
const input=(action,quantity=1,more={})=>({action,quantity,unit:'件',date:'2026-10-22',...more});
function classified(type,state){return {...base,...classifyInventory(base,type,state)};}
function move(item,action,qty=1,more={}){const result=applyMovement(item,input(action,qty,more));return {...item,...result.patch};}
test('legacy and unknown types remain unclassified without mutating or guessing',()=>{
  const item={...base,category:'設備',note:'床墊'};assert.equal(inventoryType(item),'unclassified');assert.equal(inventoryType({...item,inventoryType:'unexpected'}),'unclassified');
  assert.deepEqual(movementOptions(item),[]);assert.match(inventorySummary(item),/待分類/);assert.equal(lowInventory({...item,quantity:0}),false);
  assert.throws(()=>move(item,'out'),/分類/);assert.deepEqual(item,{...base,category:'設備',note:'床墊'});
});
test('explicit classification keeps original quantity and allocates chosen initial state',()=>{
  assert.deepEqual(classifyInventory(base,'linen','dirty'),{inventoryType:'linen',stateCounts:{clean:0,inRoom:0,dirty:10,laundry:0,retired:0}});
  assert.throws(()=>classifyInventory(base,'asset','retired'));
  assert.throws(()=>classifyInventory(classified('asset','spare'),'linen','clean'),/不可/);
  assert.throws(()=>classifyInventory({...base,quantity:0.5},'asset','spare'),/整數/);
});
test('consumables support actual receipt and use, precise decimals and no negative balance',()=>{
  let item=classified('consumable');item=move(item,'in',0.1);item=move(item,'out',0.1);assert.equal(item.quantity,10);
  assert.equal(move(item,'out',10).quantity,0);assert.throws(()=>move(item,'out',11),/不足/);assert.throws(()=>move(item,'dirty:laundry'),/動作/);
  assert.equal(lowInventory({...item,quantity:2}),true);
});
test('equipment transitions preserve active count until retirement; replacement keeps retirement history',()=>{
  let item={...classified('asset','spare'),location:'201 房',purchasedDate:'2026-01-01'};
  for(const action of ['spare:inUse','inUse:repair','repair:spare']){item=move(item,action,4);assert.equal(item.quantity,10);}
  assert.throws(()=>move(item,'spare:retired'),/原因/);
  const result=applyMovement(item,input('spare:retired',2,{note:'故障汰換'}));item={...item,...result.patch};
  assert.equal(item.quantity,8);assert.equal(item.stateCounts.retired,2);assert.equal(result.history.location,'201 房');assert.equal(result.history.purchasedDate,'2026-01-01');
  item=move(item,'receive',2);assert.equal(item.quantity,10);assert.equal(item.stateCounts.retired,2);
  assert.throws(()=>move(item,'out'),/動作/);assert.throws(()=>move(item,'spare:inUse',0.5),/整數/);
});
test('linen send/partial return transfers counts without treating laundry as consumption',()=>{
  let item=classified('linen','clean');for(const action of ['clean:inRoom','inRoom:dirty','dirty:laundry'])item=move(item,action,10);
  assert.equal(item.quantity,10);assert.equal(item.stateCounts.laundry,10);
  item=move(item,'laundry:clean',8);assert.equal(item.quantity,10);assert.equal(item.stateCounts.clean,8);assert.equal(item.stateCounts.laundry,2);assert.match(inventorySummary(item),/送洗中 2/);
  assert.throws(()=>move(item,'laundry:clean',3),/不足/);item=move(item,'laundry:clean',2);assert.equal(item.stateCounts.laundry,0);
});
test('every available state transition respects totals and records unit and before/after snapshots',()=>{
  for(const type of ['asset','linen'])for(const option of movementOptions(classified(type,type==='asset'?'spare':'clean'))){
    const item=classified(type,option.from||option.to);const {patch,history}=applyMovement(item,input(option.id,2,{note:'合成原因'}));
    assert.equal(patch.quantity,option.to==='retired'?8:option.from?10:12);assert.equal(history.unit,'件');assert.equal(history.beforeStates[option.from||option.to],10);
    assert.equal(Object.values(patch.stateCounts).reduce((a,b)=>a+b,0),option.from?10:12);
  }
});
test('reject invalid quantities, unit mismatch, dates and corrupted balances',()=>{
  const item=classified('consumable');for(const qty of [-1,0,NaN,Infinity,1e10])assert.throws(()=>move(item,'in',qty));
  for(const value of ['',null,undefined,'abc',-1,Infinity])assert.throws(()=>nonnegative(value));
  assert.throws(()=>move(item,'in',1,{unit:'箱'}),/單位/);assert.throws(()=>move(item,'in',1,{date:'2026-02-30'}),/日期/);
  assert.throws(()=>move({...classified('linen','clean'),quantity:99},'clean:inRoom'),/不一致/);
  assert.throws(()=>move({...classified('asset','spare'),stateCounts:{spare:-2}},'spare:inUse'));
});
test('error guidance preserves true codes without claiming rules deployment caused every error',()=>{
  assert.match(inventoryError({code:'permission-denied'},'刪除'),/管理員資格/);
  assert.match(inventoryError({code:'unavailable'},'刪除'),/結果尚無法確認/);
  assert.match(inventoryError({code:'failed-precondition',message:'detail'}),/failed-precondition.*detail/);
});
