import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const sdk=await readFile(new URL('./firebase-stub.js',import.meta.url),'utf8');
const jpeg=await readFile(new URL('../fixtures/synthetic-room.jpg',import.meta.url));
const departing={id:'SYNTHETIC-CHECKOUT',guestName:'合成退房旅客（較長的名字）',phone:'0900000000',startDate:'2026-10-09',endDate:'2026-10-10',status:'confirmed',people:12,paidAmount:3000,depositRequired:3000,totalAmount:12000,notes:'合成房務備註，僅用於隔離驗收。',housekeepingReport:null};
const arriving={...departing,id:'SYNTHETIC-ARRIVAL',guestName:'合成入住旅客',startDate:'2026-10-10',endDate:'2026-10-12'};
async function isolated(page,{staff=true,offline=false,failUpload=false,failReport=false,loseReply=false,failSettings=false,completed=false}={}){
  const report={bookingId:departing.id,startDate:departing.startDate,checkoutDate:departing.endDate,status:'completed',completedAt:'2026-10-10T04:00:00Z',completedBy:'synthetic-housekeeper',completedByEmail:'synthetic@example.invalid',note:'合成整備完成紀錄',photoId:'HP-SYNTHETIC',photoCount:1};
  await page.addInitScript(({staff,offline,failUpload,failReport,loseReply,failSettings,completed,departing,arriving,report})=>window.__fake={authEmail:staff?'51bbsadmin@gmail.com':'admin@example.invalid',authUid:staff?'synthetic-housekeeper':'synthetic-admin',bookings:[{...departing,housekeepingReport:completed?report:null},arriving],paymentTransactions:[],expenseTransactions:[],inventoryItems:[{id:'SYNTHETIC-STOCK',name:'合成備品',quantity:12,unit:'包',minQuantity:2}],availability:[],writes:[],offline,failUpload,failReport,loseReply,failSettings,uploadCalls:[],reportCalls:[],settingCalls:[],photoReads:[],report},{staff,offline,failUpload,failReport,loseReply,failSettings,completed,departing,arriving,report});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.host==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:sdk});
    if(url.host!=='127.0.0.1:4178')return route.abort();
    if(url.pathname==='/api/housekeeping-calendar'){
      const state=await page.evaluate(()=>({offline:window.__fake.offline,bookings:window.__fake.bookings}));
      return state.offline?route.fulfill({status:503,json:{error:'SYNTHETIC_OFFLINE'}}):route.fulfill({json:{month:url.searchParams.get('month'),bookings:state.bookings}});
    }
    if(url.pathname==='/api/housekeeping-photo'){
      if(request.method()==='GET'){await page.evaluate(h=>window.__fake.photoReads.push(h),await request.allHeaders());return route.fulfill({contentType:'image/jpeg',body:jpeg,headers:{'Cache-Control':'private, no-store'}});}
      const body=request.postDataJSON();const fail=await page.evaluate(b=>{window.__fake.uploadCalls.push(b);return window.__fake.failUpload;},body);
      return fail?route.fulfill({status:503,json:{error:'SYNTHETIC_SAVE_FAILURE'}}):route.fulfill({json:{ok:true,id:'HP-SYNTHETIC',uploaded:true}});
    }
    if(url.pathname==='/api/housekeeping-report'){
      const body=request.postDataJSON(),state=await page.evaluate(b=>{window.__fake.reportCalls.push(b);if(window.__fake.failReport)return {fail:true};const booking=window.__fake.bookings.find(x=>x.id===b.bookingId);if(!booking.housekeepingReport)booking.housekeepingReport={...window.__fake.report,note:b.note};const lose=window.__fake.loseReply;window.__fake.loseReply=false;return {lose,report:booking.housekeepingReport};},body);
      if(state.fail)return route.fulfill({status:503,json:{error:'SYNTHETIC_REPORT_FAILURE'}});if(state.lose)return route.abort('failed');return route.fulfill({json:{ok:true,report:state.report}});
    }
    if(url.pathname==='/api/admin-housekeeping'){
      const settings={enabled:false,email:'',contactName:'',arrivalTime:'',checkoutTime:'',timeZone:'Asia/Taipei',ready:false};
      if(request.method()==='POST'){const body=request.postDataJSON(),fail=await page.evaluate(b=>{window.__fake.settingCalls.push(b);return window.__fake.failSettings;},body);return fail?route.fulfill({status:503,json:{error:'SYNTHETIC_CONFIG_FAILURE'}}):route.fulfill({json:{ok:true,settings:{...settings,...body,enabled:false},schedulerConfigured:false,gmailConfigured:false}});}
      const reports=await page.evaluate(()=>window.__fake.bookings.filter(b=>b.housekeepingReport).map(b=>b.housekeepingReport));return route.fulfill({json:{ok:true,settings,reports,schedulerConfigured:false,gmailConfigured:false}});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'SYNTHETIC_API_FAILURE'}});
    return route.continue();
  });
}
async function staffPage(page){await page.goto('/housekeeping/?date=2026-10-10&booking=SYNTHETIC-CHECKOUT');await expect(page.locator('#appView')).toBeVisible();await expect(page.locator('.report-form')).toBeVisible();}
async function fillReport(page){const form=page.locator('.report-form');await form.locator('[name=cleaned]').check();await form.locator('[name=photo]').setInputFiles({name:'synthetic-living-room-confirmation.jpg',mimeType:'image/jpeg',buffer:jpeg});await form.locator('[name=note]').fill('合成清潔完成，鑰匙已備妥。');return form;}
test('staff calendar stays compact with checkout and arrival cards at phone and desktop widths',async({page})=>{
  await isolated(page);await staffPage(page);
  for(const width of [320,375,390,768,1440]){
    await page.setViewportSize({width,height:844});
    await expect(page.locator('[data-day="2026-10-10"] .count')).toHaveText('2組');await expect(page.locator('#dayBookings .booking')).toHaveCount(2);
    const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,badCells:[...document.querySelectorAll('.day .count')].filter(x=>x.textContent.length>3||x.getBoundingClientRect().right>x.parentElement.getBoundingClientRect().right+1).length}));expect(geometry).toEqual({overflow:false,badCells:0});
    await page.screenshot({path:`test-results/housekeeping-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'庫存管理',exact:true}).click();await expect(page.locator('#inventoryPanel')).toBeVisible();await expect(page.locator('#stockItem option')).toHaveCount(2);expect(await page.evaluate(()=>window.__fake.writes.filter(x=>['bookings','paymentTransactions'].includes(x.ref.collection)).length)).toBe(0);
});
test('failed photo never calls completion; input is preserved and retry completes the exact stay',async({page})=>{
  await page.setViewportSize({width:375,height:812});await isolated(page,{failUpload:true});await staffPage(page);const form=await fillReport(page);await form.getByRole('button',{name:'完成回報',exact:true}).click();await expect(form.locator('.message')).toContainText('再試一次');
  expect(await page.evaluate(()=>window.__fake.reportCalls.length)).toBe(0);await expect(page.locator('.completed-card')).toHaveCount(0);await expect(form.locator('[name=note]')).toHaveValue('合成清潔完成，鑰匙已備妥。');expect(await form.locator('[name=photo]').evaluate(x=>x.files.length)).toBe(1);await expect(form.locator('[name=cleaned]')).toBeChecked();
  await page.evaluate(()=>window.__fake.failUpload=false);await form.getByRole('button',{name:'完成回報',exact:true}).click();await expect(page.locator('.completed-card')).toContainText('退房整備完成');
  const request=await page.evaluate(()=>window.__fake.reportCalls[0]);expect(request).toMatchObject({bookingId:departing.id,startDate:departing.startDate,checkoutDate:departing.endDate,cleaned:true,photoId:'HP-SYNTHETIC'});const bytes=Buffer.from((await page.evaluate(()=>window.__fake.uploadCalls[0])).photoBase64,'base64');expect(bytes.length).toBeLessThanOrEqual(500*1024);expect(bytes[0]).toBe(255);expect(bytes[1]).toBe(216);
});
test('completion failure and lost reply retry reuses the uploaded photo and original record',async({page})=>{
  await isolated(page,{failReport:true});await staffPage(page);const form=await fillReport(page);await form.getByRole('button',{name:'完成回報',exact:true}).click();await expect(form.locator('.message')).toContainText('再試一次');
  await page.evaluate(()=>{window.__fake.failReport=false;window.__fake.loseReply=true;});await form.getByRole('button',{name:'完成回報',exact:true}).click();await expect(form.locator('.message')).toContainText('連線中斷');await expect(page.locator('.completed-card')).toHaveCount(0);
  await form.getByRole('button',{name:'完成回報',exact:true}).click();await expect(page.locator('.completed-card')).toContainText('退房整備完成');const counts=await page.evaluate(()=>({uploads:window.__fake.uploadCalls.length,posts:window.__fake.reportCalls.length,records:window.__fake.bookings.filter(b=>b.housekeepingReport).length}));expect(counts).toEqual({uploads:1,posts:3,records:1});
});
test('rapid report submits save one photo and one report; completion does not eagerly fetch the photo',async({page})=>{
  await isolated(page);await staffPage(page);const form=await fillReport(page);await form.evaluate(f=>{f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await expect(page.locator('.completed-card')).toBeVisible();expect(await page.evaluate(()=>({uploads:window.__fake.uploadCalls.length,reports:window.__fake.reportCalls.length,reads:window.__fake.photoReads.length}))).toEqual({uploads:1,reports:1,reads:0});
});
test('failed staff calendar shows unavailable, disables dates and can retry without false completion',async({page})=>{
  await isolated(page,{offline:true});await page.goto('/housekeeping/?date=2026-10-10');await expect(page.locator('#calendarMessage')).toContainText('無法確認');await expect(page.locator('.report-form')).toHaveCount(0);await expect(page.locator('[data-day="2026-10-10"]')).toBeDisabled();await page.evaluate(()=>window.__fake.offline=false);await page.getByRole('button',{name:'重新整理',exact:true}).first().click();await expect(page.locator('.report-form')).toBeVisible();
});
test('mobile admin menu keeps daily calendar short, details below, and finance functions accessible',async({page})=>{
  await isolated(page,{staff:false});await page.goto('/admin/');await expect(page.locator('#dashboardView')).toBeVisible();await page.getByRole('button',{name:'營運管理',exact:true}).click();
  for(const width of [320,375,390,768,1440]){
    await page.setViewportSize({width,height:844});await page.locator('[data-arrival-date="2026-10-10"]').click();await expect(page.locator('#operationsOrders .ops-order')).toHaveCount(2);await expect(page.locator('#selectedDayOverview')).toContainText('退房');
    expect(await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,badCells:[...document.querySelectorAll('.arrival-day-note')].filter(x=>x.textContent.length>3||x.getBoundingClientRect().right>x.parentElement.getBoundingClientRect().right+1).length}))).toEqual({overflow:false,badCells:0});
    await page.screenshot({path:`test-results/admin-workflow-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#workspaceMenu')).toBeVisible();await expect(page.locator('.tabs')).toBeHidden();await expect(page.locator('#clearLegacyOrders')).toBeHidden();await expect(page.locator('#clearLegacyOrders')).toBeDisabled();
  await page.locator('#opsWorkspaceMenu').selectOption('payments');await expect(page.locator('#paymentForm')).toBeVisible();await expect(page.locator('#operationsOrders')).toBeHidden();await expect(page.locator('#opsPaymentBooking option')).toHaveCount(3);
  await page.locator('#opsWorkspaceMenu').selectOption('expenses');await expect(page.locator('#expenseForm')).toBeVisible();expect(await page.evaluate(()=>window.__fake.writes.filter(x=>['bookings','paymentTransactions'].includes(x.ref.collection)).length)).toBe(0);
});
test('reminder settings start empty and inactive; failed saves keep values and cannot start real reminders',async({page})=>{
  await page.setViewportSize({width:375,height:812});await isolated(page,{staff:false,failSettings:true});await page.goto('/admin/');await expect(page.locator('#dashboardView')).toBeVisible();await page.locator('#workspaceMenu').selectOption('housekeeping');await expect(page.locator('#housekeepingReminderStatus')).toContainText('尚未啟用');await expect(page.locator('#housekeepingReminderEmail')).toHaveValue('');await expect(page.locator('#activateHousekeepingReminders')).toBeHidden();
  await page.locator('#housekeepingContactName').fill('合成房務');await page.locator('#housekeepingReminderEmail').fill('synthetic@example.invalid');await page.locator('#housekeepingArrivalTime').fill('09:00');await page.locator('#housekeepingCheckoutTime').fill('12:00');await page.locator('#housekeepingReminderForm button[type=submit]').click();await expect(page.locator('#housekeepingReminderMessage')).toContainText('再試一次');await expect(page.locator('#housekeepingReminderEmail')).toHaveValue('synthetic@example.invalid');
  await page.evaluate(()=>window.__fake.failSettings=false);await page.locator('#housekeepingReminderForm button[type=submit]').click();await expect(page.locator('#housekeepingReminderMessage')).toContainText('保持停用');expect(await page.evaluate(()=>window.__fake.settingCalls.every(x=>x.activate===false))).toBe(true);
});
test('admin only loads private completed photos on demand with a bearer header and a local blob URL',async({page})=>{
  await isolated(page,{staff:false,completed:true});await page.goto('/admin/');await expect(page.locator('#dashboardView')).toBeVisible();await page.getByRole('button',{name:'房務管理',exact:true}).click();await expect(page.locator('#housekeepingReports .completed-card')).toBeVisible();expect(await page.evaluate(()=>window.__fake.photoReads.length)).toBe(0);
  await page.locator('#housekeepingReports').getByRole('button',{name:'查看確認照片'}).click();const image=page.locator('#housekeepingReports .photo-preview');await expect(image).toBeVisible();expect(await image.getAttribute('src')).toMatch(/^blob:/);expect((await page.evaluate(()=>window.__fake.photoReads[0])).authorization).toBe('Bearer FAKE');
});
