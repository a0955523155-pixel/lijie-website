import {doc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {applyMovement} from './inventory-model.js';
// A stable operation id also makes a retry safe when a commit response was lost.
export async function commitMovement(db,uid,input,operationId){
  const itemRef=doc(db,'inventoryItems',input.itemId),historyRef=doc(db,'inventoryTransactions',operationId);
  return runTransaction(db,async tx=>{
    const prior=await tx.get(historyRef);if(prior.exists())return {alreadySaved:true};
    const snap=await tx.get(itemRef);if(!snap.exists())throw new Error('找不到備品。');
    const item=snap.data(),{patch,history}=applyMovement(item,input);
    tx.set(itemRef,{...patch,updatedAt:serverTimestamp(),updatedBy:uid},{merge:true});
    tx.set(historyRef,{...history,itemId:input.itemId,itemName:item.name,createdBy:uid,createdAt:serverTimestamp()});
    return {alreadySaved:false};
  });
}
export async function commitNewInventory(db,uid,data,itemId){
  const itemRef=doc(db,'inventoryItems',itemId),historyRef=doc(db,'inventoryTransactions','initial-'+itemId);
  return runTransaction(db,async tx=>{
    if((await tx.get(itemRef)).exists())return;
    tx.set(itemRef,{...data,createdBy:uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    tx.set(historyRef,{itemId,itemName:data.name,inventoryType:data.inventoryType,type:'initial',actionLabel:'初始建檔',unit:data.unit,quantity:data.quantity,beforeQuantity:0,afterQuantity:data.quantity,beforeStates:null,afterStates:data.stateCounts??null,location:data.location||'',purchasedDate:data.purchasedDate||'',date:new Date().toLocaleDateString('en-CA'),createdBy:uid,createdAt:serverTimestamp()});
  });
}
export function movementAttempt(form,input){
  const fingerprint=JSON.stringify(input);
  if(form.inventoryAttempt&&form.inventoryAttempt.fingerprint!==fingerprint)throw new Error('上次操作結果尚未確認，請先以原內容重試核對，再登記下一筆。');
  return (form.inventoryAttempt??={id:crypto.randomUUID(),fingerprint}).id;
}
