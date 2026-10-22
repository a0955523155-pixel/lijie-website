import {test,expect} from '@playwright/test';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const sdk=await readFile(new URL('./firebase-stub.js',import.meta.url),'utf8');
const legacy={id:'legacy',name:'合成舊床墊（保留原資料）',quantity:3,unit:'張',category:'寢具',note:'不應自行猜類型'};
const consumable={id:'toothbrush',name:'合成牙刷',inventoryType:'consumable',quantity:10,unit:'支',minQuantity:2,unitCost:5};
const asset={id:'dryer',name:'合成吹風機',inventoryType:'asset',quantity:2,unit:'台',location:'201 房',purchasedDate:'2026-01-01',stateCounts:{inUse:1,spare:1,repair:0,retired:0}};
const linen={id:'towel',name:'合成毛巾',inventoryType:'linen',quantity:10,unit:'條',stateCounts:{clean:10,inRoom:0,dirty:0,laundry:0,retired:0}};
async function isolate(page,extra={}){
  await page.addInitScript(({items,extra})=>window.__fake={bookings:[],paymentTransactions:[],expenseTransactions:[],inventoryItems:items,inventoryTransactions:[],availability:[],writes:[],...extra},{items:[legacy,consumable,asset,linen],extra});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.host==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:sdk});
    if(url.host!=='127.0.0.1:4178')return route.abort();
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{bookings:[],reports:[],notifications:[],settings:{enabled:false}}});
    return route.continue();
  });
}
async function admin(page){await page.goto('/admin/?tab=inventory');await expect(page.locator('#dashboardView')).toBeVisible();if(await page.locator('#workspaceMenu').isVisible())await page.locator('#workspaceMenu').selectOption('inventory');else await page.locator('.tab[data-tab=inventory]').click();await expect(page.locator('[data-inventory-id=legacy]')).toBeVisible();}
async function deleteDialog(page){await page.locator('[data-inventory-id=legacy] .inventory-delete').click();await expect(page.locator('#inventoryDeleteDialog')).toBeVisible();}
async function movement(page,item,action,qty,note=''){
  await page.locator('#stockItem').selectOption(item);await page.locator('#stockType').selectOption(action);await page.locator('#stockQty').fill(String(qty));await page.locator('#stockNote').fill(note);await page.locator('#stockMovementForm button[type=submit]').click();
}
const state=page=>page.evaluate(()=>structuredClone(window.__fake));
test('viewing and refreshing old inventory does not classify or write; cancellation does not delete',async({page})=>{
  await isolate(page);await admin(page);await page.locator('#refreshInventory').click();await deleteDialog(page);await page.locator('#cancelInventoryDelete').click();
  await deleteDialog(page);await page.keyboard.press('Escape');await expect(page.locator('#inventoryDeleteDialog')).not.toBeVisible();
  const data=await state(page);expect(data.writes.filter(x=>x.ref.collection.startsWith('inventory'))).toEqual([]);expect(data.inventoryItems[0]).toEqual(legacy);expect(data.deleteCalls||0).toBe(0);await expect(page.locator('#stockItem option[value=legacy]')).toHaveCount(0);
});
test('successful deletion preserves history, and rapid repeats make one deletion call',async({page})=>{
  await isolate(page,{slowWrites:true,inventoryTransactions:[{id:'old',itemId:'legacy',itemName:legacy.name,type:'in',quantity:3,date:'2026-01-01'}]});await admin(page);await deleteDialog(page);
  await page.evaluate(()=>{const b=document.querySelector('#confirmInventoryDelete');b.dispatchEvent(new Event('click'));b.dispatchEvent(new Event('click'));});
  await expect(page.locator('#inventoryItemMessage')).toContainText('已刪除');await expect(page.locator('[data-inventory-id=legacy]')).toHaveCount(0);
  const data=await state(page);expect(data.deleteCalls).toBe(1);expect(data.inventoryTransactions).toHaveLength(1);
});
for(const [code,text] of [['permission-denied','管理員資格'],['unavailable','結果尚無法確認'],['failed-precondition','failed-precondition']])test('delete error retains true '+code+' and keeps dialog actionable',async({page})=>{
  await isolate(page,{deleteCode:code});await admin(page);await deleteDialog(page);await page.locator('#confirmInventoryDelete').click();
  await expect(page.locator('#inventoryDeleteMessage')).toContainText(text);await expect(page.locator('#inventoryDeleteMessage')).toContainText(code);await expect(page.locator('#confirmInventoryDelete')).toBeEnabled();
  expect((await state(page)).inventoryItems[0]).toEqual(legacy);await page.locator('#cancelInventoryDelete').click();
});
test('delete committed but refresh failed reports success and never offers a repeat deletion',async({page})=>{
  await isolate(page,{failReadAfterDelete:true});await admin(page);await deleteDialog(page);await page.locator('#confirmInventoryDelete').click();
  await expect(page.locator('#inventoryItemMessage')).toContainText('已刪除');await expect(page.locator('#inventoryItemMessage')).toContainText('刷新失敗');await expect(page.locator('#inventoryDeleteDialog')).not.toBeVisible();await expect(page.locator('[data-inventory-id=legacy]')).toHaveCount(0);
  await page.evaluate(()=>window.__fake.failInventoryRefresh=false);await page.locator('#refreshInventory').click();expect((await state(page)).deleteCalls).toBe(1);
});
test('explicitly classifying one old item preserves its quantity and unrelated fields',async({page})=>{
  await isolate(page);await admin(page);await page.locator('[data-inventory-id=legacy] .inventory-edit').click();
  await expect(page.locator('#editInventoryType')).toHaveValue('');await expect(page.locator('#editInventoryQty')).toHaveAttribute('readonly','');
  await page.locator('#editInventoryType').selectOption('asset');await page.locator('#editInventoryInitialState').selectOption('inUse');await page.locator('#editInventoryLocation').fill('301 房');await page.locator('#inventoryEditForm button[type=submit]').click();
  await expect(page.locator('#inventoryItemMessage')).toContainText('已更新');const data=await state(page),item=data.inventoryItems.find(i=>i.id==='legacy');
  expect(item).toMatchObject({...legacy,inventoryType:'asset',location:'301 房',stateCounts:{inUse:3,spare:0,repair:0,retired:0}});expect(data.inventoryTransactions).toHaveLength(1);
  await page.locator('[data-inventory-id=legacy] .inventory-edit').click();await expect(page.locator('#editInventoryType')).toBeDisabled();await expect(page.locator('#editInventoryUnit')).toHaveAttribute('readonly','');
});
test('asset repair and retirement preserve position and history; consumable issue uses its recorded unit',async({page})=>{
  await isolate(page);await admin(page);await movement(page,'dryer','inUse:repair',1);await expect(page.locator('#stockMessage')).toContainText('已更新');
  await movement(page,'dryer','repair:retired',1,'馬達故障汰換');await expect.poll(async()=> (await state(page)).inventoryTransactions.length).toBe(2);
  await movement(page,'toothbrush','out',3);await expect.poll(async()=> (await state(page)).inventoryTransactions.length).toBe(3);
  const data=await state(page);expect(data.inventoryItems.find(x=>x.id==='dryer')).toMatchObject({quantity:1,stateCounts:{inUse:0,spare:1,repair:0,retired:1},location:'201 房'});
  expect(data.inventoryTransactions[1]).toMatchObject({unit:'台',note:'馬達故障汰換',location:'201 房',purchasedDate:'2026-01-01'});expect(data.inventoryItems.find(x=>x.id==='toothbrush').quantity).toBe(7);
});
test('linen partial returns leave outstanding laundry visible and active total unchanged',async({page})=>{
  await isolate(page);await admin(page);
  for(const action of ['clean:inRoom','inRoom:dirty','dirty:laundry']){await movement(page,'towel',action,10);await expect.poll(async()=> (await state(page)).inventoryItems.find(i=>i.id==='towel').stateCounts[action.split(':')[1]]).toBe(10);}
  await movement(page,'towel','laundry:clean',8);await expect.poll(async()=> (await state(page)).inventoryTransactions.length).toBe(4);
  await page.locator('[data-inventory-type=linen]').click();await expect(page.locator('[data-inventory-id=towel]')).toContainText('送洗中 2 條');
  expect((await state(page)).inventoryItems.find(x=>x.id==='towel')).toMatchObject({quantity:10,stateCounts:{clean:8,inRoom:0,dirty:0,laundry:2,retired:0}});
  await movement(page,'towel','laundry:clean',3);await expect(page.locator('#stockMessage')).toContainText('數量不足');expect((await state(page)).inventoryTransactions).toHaveLength(4);
});
test('transaction failure is atomic, retains input, and changed units reject writes',async({page})=>{
  await isolate(page,{transactionCode:'permission-denied'});await admin(page);await movement(page,'toothbrush','out',3,'保留輸入');await expect(page.locator('#stockMessage')).toContainText('permission-denied');
  expect((await state(page)).inventoryTransactions).toEqual([]);expect((await state(page)).inventoryItems.find(i=>i.id==='toothbrush').quantity).toBe(10);await expect(page.locator('#stockNote')).toHaveValue('保留輸入');
  await page.evaluate(()=>{window.__fake.transactionCode='';window.__fake.inventoryItems.find(i=>i.id==='toothbrush').unit='箱';});await page.locator('#stockMovementForm button[type=submit]').click();await expect(page.locator('#stockMessage')).toContainText('單位已變更');expect((await state(page)).inventoryTransactions).toEqual([]);
});
test('double submission and lost response retry do not double issue inventory',async({page})=>{
  await isolate(page,{slowWrites:true,loseTransactionReply:true});await admin(page);
  await page.locator('#stockItem').selectOption('toothbrush');await page.locator('#stockType').selectOption('out');await page.locator('#stockQty').fill('2');
  await page.evaluate(()=>{const form=document.querySelector('#stockMovementForm');form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));});
  await expect(page.locator('#stockMessage')).toContainText('結果尚無法確認');expect((await state(page)).inventoryTransactions).toHaveLength(1);
  await page.locator('#stockQty').fill('3');await page.locator('#stockMovementForm button[type=submit]').click();await expect(page.locator('#stockMessage')).toContainText('原內容重試');
  await page.locator('#stockQty').fill('2');await page.locator('#stockMovementForm button[type=submit]').click();await expect(page.locator('#stockMessage')).toContainText('已更新');
  const data=await state(page);expect(data.inventoryTransactions).toHaveLength(1);expect(data.inventoryItems.find(i=>i.id==='toothbrush').quantity).toBe(8);
});
test('simultaneous independent issues retry on conflict and cannot overdraw',async({page})=>{
  await isolate(page,{slowWrites:true});await admin(page);
  const outcomes=await page.evaluate(async()=>{
    const {commitMovement}=await import('/js/inventory-store.js');
    const input={itemId:'toothbrush',unit:'支',action:'out',quantity:7,date:'2026-10-22',note:'合成並行'};
    return (await Promise.allSettled([commitMovement({},'synthetic-admin',input,'op-a'),commitMovement({},'synthetic-admin',input,'op-b')])).map(r=>r.status);
  });
  expect(outcomes.sort()).toEqual(['fulfilled','rejected']);const data=await state(page);expect(data.inventoryTransactions).toHaveLength(1);expect(data.inventoryItems.find(i=>i.id==='toothbrush').quantity).toBe(3);
});
test('imports cannot overwrite a typed item, and new rows remain unclassified',async({page})=>{
  await isolate(page);await admin(page);await page.locator('#inventoryImportFile').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from('品名,單位,目前庫存\n合成牙刷,箱,999')});await page.locator('#importInventoryFile').click();await expect(page.locator('#inventoryImportMessage')).toContainText('品名重複');expect((await state(page)).writes.filter(x=>x.ref.collection.startsWith('inventory'))).toEqual([]);
  await page.locator('#inventoryImportFile').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from('品名,單位,目前庫存\n合成新備品,包,5')});await page.locator('#importInventoryFile').click();await expect(page.locator('#inventoryImportMessage')).toContainText('匯入完成');
  expect((await state(page)).inventoryItems.find(x=>x.name==='合成新備品')).toMatchObject({quantity:5,unit:'包'});expect((await state(page)).inventoryItems.find(x=>x.name==='合成新備品').inventoryType).toBeUndefined();
});
test('three tabs, creation and edit dialogs fit phone and desktop sizes with touch controls',async({page})=>{
  await isolate(page);await admin(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [320,375,390,768,1440]){
    await page.setViewportSize({width,height:844});
    for(const type of ['asset','consumable','linen','unclassified']){await page.locator('[data-inventory-type='+type+']').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
    await page.locator('[data-inventory-id=legacy] .inventory-edit').click();await page.locator('#editInventoryType').selectOption('asset');
    expect(await page.locator('#inventoryEditDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();await page.locator('#cancelInventoryEdit').click();
    await page.screenshot({path:'test-results/inventory-'+width+'.png',fullPage:true});
    const button=await page.locator('[data-inventory-type=linen]').boundingBox();expect(button.height).toBeGreaterThanOrEqual(44);
  }expect(errors).toEqual([]);
});
test('housekeeping uses the same linen transfer model and cannot issue unclassified stock',async({page})=>{
  await isolate(page,{authEmail:'51bbsadmin@gmail.com'});await page.setViewportSize({width:390,height:844});await page.goto('/housekeeping/');await expect(page.locator('#appView')).toBeVisible();await page.locator('.bottom-tab[data-go=inventory]').click();await expect(page.locator('#stockItem option[value=legacy]')).toHaveCount(0);
  await page.locator('#stockItem').selectOption('towel');await expect(page.locator('#stockAction option[value=out]')).toHaveCount(0);await page.locator('#stockAction').selectOption('clean:inRoom');await page.locator('#stockQty').fill('3');await page.locator('#movementForm button').click();await expect(page.locator('#stockMessage')).toContainText('已保存');
  expect((await state(page)).inventoryItems.find(x=>x.id==='towel')).toMatchObject({quantity:10,stateCounts:{clean:7,inRoom:3,dirty:0,laundry:0,retired:0}});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();await page.screenshot({path:'test-results/inventory-housekeeping-390.png',fullPage:true});
});
for(const [type,initial] of [['asset','spare'],['consumable',''],['linen','clean']])test('create '+type+' validates input and records its initial balance atomically',async({page})=>{
  await isolate(page);await admin(page);await page.locator('#inventoryType').selectOption(type);if(initial)await page.locator('#inventoryInitialState').selectOption(initial);
  await page.locator('#inventoryName').fill('合成新建'+type);await page.locator('#inventoryUnit').fill('件');await page.locator('#inventoryQty').fill('4');
  await page.locator('#inventoryItemForm button[type=submit]').click();await expect(page.locator('#inventoryItemMessage')).toContainText('已建立');
  const data=await state(page),item=data.inventoryItems.find(x=>x.name==='合成新建'+type);expect(item).toMatchObject({inventoryType:type,quantity:4,unit:'件'});
  expect(data.inventoryTransactions).toHaveLength(1);expect(data.inventoryTransactions[0]).toMatchObject({type:'initial',beforeQuantity:0,afterQuantity:4,unit:'件'});if(initial)expect(item.stateCounts[initial]).toBe(4);
});
test('native and programmatic negative input cannot write any balance',async({page})=>{
  await isolate(page);await admin(page);await page.locator('#stockItem').selectOption('toothbrush');await page.locator('#stockType').selectOption('out');await page.locator('#stockQty').fill('-1');
  await page.locator('#stockMovementForm button[type=submit]').click();expect((await state(page)).inventoryTransactions).toHaveLength(0);
  await page.locator('#stockMovementForm').dispatchEvent('submit');await expect(page.locator('#stockMessage')).toContainText('數量必須');expect((await state(page)).inventoryTransactions).toHaveLength(0);
});
test('missing admin document is modeled explicitly and cannot open admin inventory',async({page})=>{
  await isolate(page,{adminDenied:true});await page.goto('/admin/');await expect(page.locator('#loginMessage')).toContainText('尚未被授權');await expect(page.locator('#dashboardView')).not.toBeVisible();expect((await state(page)).writes).toEqual([]);
});
test('classification refuses a concurrent quantity change instead of allocating an unseen balance',async({page})=>{
  await isolate(page);await admin(page);await page.locator('[data-inventory-id=legacy] .inventory-edit').click();await expect(page.locator('#editInventoryUnit')).toHaveAttribute('readonly','');
  await page.locator('#editInventoryType').selectOption('asset');await page.locator('#editInventoryInitialState').selectOption('inUse');await page.evaluate(()=>window.__fake.inventoryItems.find(x=>x.id==='legacy').quantity=4);await page.locator('#inventoryEditForm button[type=submit]').click();await expect(page.locator('#inventoryEditMessage')).toContainText('數量已變更');
  expect((await state(page)).inventoryItems.find(x=>x.id==='legacy').inventoryType).toBeUndefined();expect((await state(page)).inventoryTransactions).toEqual([]);
});
test('prepared freeze patch applies and stops all admin and staff inventory write handlers',async({page,browser})=>{
  const dir=await mkdtemp(path.join(tmpdir(),'lijie-inventory-freeze-'));
  for(const file of ['admin/admin.js','housekeeping/housekeeping.js']){await mkdir(path.dirname(path.join(dir,file)),{recursive:true});await writeFile(path.join(dir,file),await readFile(file));}
  const applied=spawnSync('git',['apply',path.resolve('rollback/inventory-freeze.patch')],{cwd:dir,encoding:'utf8'});expect(applied.status,applied.stderr).toBe(0);
  const frozenAdmin=await readFile(path.join(dir,'admin/admin.js'),'utf8'),frozenStaff=await readFile(path.join(dir,'housekeeping/housekeeping.js'),'utf8');
  await isolate(page);await page.route('**/admin/admin.js',r=>r.fulfill({contentType:'text/javascript',body:frozenAdmin}));await admin(page);
  await page.locator('#inventoryItemForm').dispatchEvent('submit');await expect(page.locator('#inventoryItemMessage')).toContainText('暫停新增');
  await page.locator('#stockMovementForm').dispatchEvent('submit');await expect(page.locator('#stockMessage')).toContainText('暫停異動');await page.locator('#importInventoryFile').click();await expect(page.locator('#inventoryImportMessage')).toContainText('暫停匯入');
  await page.locator('[data-inventory-id=legacy] .inventory-edit').click();await page.locator('#inventoryEditForm').dispatchEvent('submit');await expect(page.locator('#inventoryEditMessage')).toContainText('暫停寫入');await page.locator('#cancelInventoryEdit').click();
  await deleteDialog(page);await page.locator('#confirmInventoryDelete').click();await expect(page.locator('#inventoryDeleteMessage')).toContainText('暫停刪除');
  expect((await state(page)).writes.filter(x=>x.ref.collection.startsWith('inventory'))).toEqual([]);expect((await state(page)).inventoryItems).toEqual([legacy,consumable,asset,linen]);
  const context=await browser.newContext(),staff=await context.newPage();await isolate(staff,{authEmail:'51bbsadmin@gmail.com'});await staff.route('**/housekeeping/housekeeping.js',r=>r.fulfill({contentType:'text/javascript',body:frozenStaff}));await staff.goto('/housekeeping/');await expect(staff.locator('#appView')).toBeVisible();await staff.locator('.tab[data-tab=inventory]').click();
  await staff.locator('#movementForm').dispatchEvent('submit');await expect(staff.locator('#stockMessage')).toContainText('暫停異動');await staff.locator('#itemForm').dispatchEvent('submit');await expect(staff.locator('#itemMessage')).toContainText('暫停新增');expect((await state(staff)).writes).toEqual([]);await context.close();
});
