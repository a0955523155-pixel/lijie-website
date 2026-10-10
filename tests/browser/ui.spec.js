import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const sdk=await readFile(new URL('./firebase-stub.js',import.meta.url),'utf8');
const syntheticBooking={id:'B-SYNTHETIC-VERY-LONG-ORDER-ID-123456789',guestName:'隔離測試旅客',startDate:'2026-11-01',endDate:'2026-11-03',people:12,status:'pending',totalAmount:12000,depositRequired:3000,paidAmount:0,paymentReportStatus:'pending',paymentReportPayerName:'隔離付款人',paymentReportLast5:'12345',paymentReportAmount:3000,paymentReportedAt:'synthetic-report',phone:'0900000000',email:'synthetic-very-long-address@example.invalid',notes:'這是合成資料，測試手機長文字以及鍵盤操作。'.repeat(6),cancellationRequestStatus:'pending',cancellationRequestReason:'合成取消原因',refundRequestStatus:'pending',refundRequestReason:'合成退款原因'};
async function isolate(page,{failCalendar=false,booking=syntheticBooking}={}){
  await page.addInitScript(({b,failCalendar})=>window.__fake={bookings:[b],paymentTransactions:[],expenseTransactions:[],inventoryItems:[],availability:[],writes:[],failCalendar,failWrites:false,slowWrites:false},{b:booking,failCalendar});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.host==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:sdk});
    if(url.host!=='127.0.0.1:4178')return route.abort();
    if(url.pathname==='/api/line-session')return route.fulfill({json:{authenticated:true}});
    if(url.pathname==='/api/public-pricing-calendar')return route.fulfill({json:{settings:{bookingWindowMonths:6,maxBookableDate:'2027-04-10'},quote:null}});
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{ok:false,error:'SYNTHETIC_API_FAILURE'}});
    return route.continue();
  });
}
async function operations(page){
  await page.goto('/admin/');await expect(page.locator('#dashboardView')).toBeVisible();
  await page.getByRole('button',{name:'營運管理',exact:true}).click();await page.locator('#orderShowAll').click();
  await expect(page.locator('.ops-order')).toHaveCount(1);
}
test('opening and refreshing legacy cancelled orders never backfills or changes finance records',async({page})=>{
  const booking={...syntheticBooking,status:'cancelled',paidAmount:3000,cancellationRefundAmount:1500,cancellationReason:'合成舊取消訂單'};
  await isolate(page,{booking});await operations(page);
  await page.locator('#refreshOperations').click();
  await expect(page.locator('.ops-order')).toHaveCount(1);
  const data=await page.evaluate(()=>({bookings:window.__fake.bookings,payments:window.__fake.paymentTransactions,expenses:window.__fake.expenseTransactions,availability:window.__fake.availability,writes:window.__fake.writes.filter(x=>['bookings','paymentTransactions','expenseTransactions','availability'].includes(x.ref.collection))}));
  expect(data).toEqual({bookings:[booking],payments:[],expenses:[],availability:[],writes:[]});
});
test('mobile and desktop order/details/calendar/review/refund layouts fit; keyboard focus and touch targets',async({page})=>{
  await isolate(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));await operations(page);
  for(const width of [320,375,390,768,1440]){
    await page.setViewportSize({width,height:844});
    await page.locator('.ops-order-details summary').click();
    await expect(page.locator('.ops-order-details dd').last()).toBeVisible();
    await page.locator('[data-cancel]').click();await expect(page.locator('#cancellationForm')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    if(width<620){const target=await page.locator('[data-verify-deposit]').boundingBox();expect(target.height).toBeGreaterThanOrEqual(44);}
    await page.locator('#cancelReason').focus();await expect(page.locator('#cancelReason')).toBeFocused();
    await page.screenshot({path:`test-results/admin-${width}.png`,fullPage:true});
    await page.locator('.ops-order-details summary').click();
  }
  expect(errors).toEqual([]);
});
test('payment save failure retains input; retry and rapid submit persist only one record',async({page})=>{
  await isolate(page);await operations(page);await page.locator('#opsPaymentBooking').selectOption(syntheticBooking.id);
  await page.locator('#opsPaymentAmount').fill('3000');await page.locator('#opsPaymentNote').fill('保留這段輸入');
  await page.evaluate(()=>window.__fake.failWrites=true);await page.locator('#paymentForm button[type=submit]').click();
  await expect(page.locator('#opsPaymentMessage')).toContainText('輸入已保留');await expect(page.locator('#opsPaymentNote')).toHaveValue('保留這段輸入');
  await expect(page.locator('#paymentForm button[type=submit]')).toBeEnabled();
  await page.evaluate(()=>{window.__fake.failWrites=false;window.__fake.slowWrites=true;const form=document.querySelector('#paymentForm');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await expect(page.locator('#opsPaymentMessage')).toContainText('紀錄已新增');
  expect(await page.evaluate(()=>window.__fake.paymentTransactions.length)).toBe(1);
});
test('review and cancellation failures preserve forms; confirmations remain required',async({page})=>{
  await isolate(page);await operations(page);let confirmations=0;page.on('dialog',async d=>{confirmations++;await d.accept();});
  await page.evaluate(()=>window.__fake.failWrites=true);
  await page.locator('[data-verify-deposit]').click();await expect(page.locator('[data-verify-deposit]')).toBeEnabled();
  expect(await page.evaluate(()=>window.__fake.bookings[0].paymentReportStatus)).toBe('pending');
  await page.locator('[data-cancel]').click();await page.locator('#cancelReason').fill('保留取消原因');
  await page.locator('#confirmCancellation').click();await expect(page.locator('#cancellationMessage')).toContainText('輸入已保留');
  await expect(page.locator('#cancelReason')).toHaveValue('保留取消原因');expect(confirmations).toBeGreaterThanOrEqual(2);
});
test('public calendar fails closed and recovers through retry',async({page})=>{
  await isolate(page,{failCalendar:true});await page.goto('/');
  await expect(page.locator('#calendarStatus')).toContainText('無法確認');await expect(page.locator('.calendar-day.available')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'重試日期狀況'})).toBeVisible();
  await page.evaluate(()=>window.__fake.failCalendar=false);await page.getByRole('button',{name:'重試日期狀況'}).click();
  await expect(page.locator('#calendarStatus')).toContainText('核帳及民宿確認');expect(await page.locator('.calendar-day.available').count()).toBeGreaterThan(0);
  await expect(page.locator('body')).not.toContainText('房間編號與別名可在後台自行修改');
});
test('LINE calendar failure disables unknown days, retains guest data, and allows retry',async({page})=>{
  await isolate(page,{failCalendar:true});await page.setViewportSize({width:375,height:812});await page.goto('/line-booking.html');
  await expect(page.locator('#dateError')).toContainText('無法確認');await expect(page.locator('#calendar .day.available')).toHaveCount(0);
  await page.locator('#guestName').fill('保留旅客');await page.locator('#email').fill('test@example.invalid');
  await page.evaluate(()=>window.__fake.failCalendar=false);await page.getByRole('button',{name:'重試日期狀況'}).click();
  expect(await page.locator('#calendar .day.available').count()).toBeGreaterThan(0);await expect(page.locator('#guestName')).toHaveValue('保留旅客');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'test-results/line-375.png',fullPage:true});
});
test('mobile reports keep tables readable inside a scroll region without page overflow',async({page})=>{
  await isolate(page);await operations(page);await page.setViewportSize({width:320,height:812});
  await page.getByRole('button',{name:'報表中心',exact:true}).click();await page.locator('#reportStartDate').fill('2026-11-01');await page.locator('#reportEndDate').fill('2026-11-30');await page.locator('#reportEndDate').dispatchEvent('change');await expect(page.locator('#financeOrdersReport table')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  const wrapper=page.locator('.report-table-wrap').first();expect(await wrapper.evaluate(e=>e.scrollWidth>e.clientWidth)).toBeTruthy();
});
test('touchscreen emulation opens details and cancellation without overlapping targets',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();
  await isolate(page);await operations(page);await page.locator('.ops-order-details summary').tap();await expect(page.locator('.ops-order-details dd').last()).toBeVisible();
  await page.locator('[data-cancel]').tap();await expect(page.locator('#cancelReason')).toBeVisible();await page.locator('#cancelReason').tap();await expect(page.locator('#cancelReason')).toBeFocused();
  await context.close();
});
test('failure after payment persistence reuses identity, prevents a changed retry from overwriting the record',async({page})=>{
  await isolate(page);await operations(page);await page.locator('#opsPaymentBooking').selectOption(syntheticBooking.id);await page.locator('#opsPaymentAmount').fill('3000');
  await page.evaluate(()=>window.__fake.failReadAfterPayment=true);await page.locator('#paymentForm button[type=submit]').click();
  await expect(page.locator('#opsPaymentMessage')).toContainText('輸入已保留');expect(await page.evaluate(()=>window.__fake.paymentTransactions.length)).toBe(1);
  await page.locator('#opsPaymentAmount').fill('4000');await page.locator('#paymentForm button[type=submit]').click();await expect(page.locator('#opsPaymentMessage')).toContainText('上次紀錄已保存');
  expect(await page.evaluate(()=>window.__fake.paymentTransactions[0].amount)).toBe(3000);
  await page.locator('#opsPaymentAmount').fill('3000');await page.locator('#paymentForm button[type=submit]').click();await expect(page.locator('#opsPaymentMessage')).toContainText('紀錄已新增');
  expect(await page.evaluate(()=>window.__fake.paymentTransactions.length)).toBe(1);
});
test('failed confirmation keeps pending status; rapid repeats call confirmation API once',async({page})=>{
  await isolate(page);await operations(page);let calls=0;page.on('request',r=>{if(r.url().includes('/api/admin-booking-confirm'))calls++;});page.on('dialog',d=>d.accept());
  await page.evaluate(()=>window.__fake.paymentTransactions.push({id:'SYNTHETIC-DEPOSIT',bookingId:window.__fake.bookings[0].id,type:'payment',amount:3000}));await page.locator('#refreshOperations').click();
  await expect(page.locator('[data-confirm-booking]')).toBeVisible();await page.evaluate(()=>{const button=document.querySelector('[data-confirm-booking]');button.dispatchEvent(new Event('click'));button.dispatchEvent(new Event('click'));});
  await expect.poll(()=>calls).toBe(1);await expect(page.locator('[data-confirm-booking]')).toBeEnabled();
  expect(await page.evaluate(()=>window.__fake.bookings[0].status)).toBe('pending');expect(await page.evaluate(()=>window.__fake.availability.length)).toBe(0);
});
