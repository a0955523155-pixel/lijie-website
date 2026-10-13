import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVercelConfig} from '../vercel.mjs';

const home={VERCEL_ENV:'production',VERCEL_PROJECT_ID:'prj_90CqiFOypCpq6VBNT4G8UPvWEOda',HOUSEKEEPING_REMINDER_CRON_ENABLED:'true'};
test('daily housekeeping schedules exist only in explicitly enabled home production',()=>{
  assert.deepEqual(buildVercelConfig(home).crons,[
    {path:'/api/housekeeping-reminders',schedule:'0 2 * * *'},
    {path:'/api/housekeeping-reminders',schedule:'0 4 * * *'},
    {path:'/api/housekeeping-reminders',schedule:'0 7 * * *'},
  ]);
  for(const env of [{},{...home,VERCEL_ENV:'preview'},{...home,VERCEL_PROJECT_ID:'other-project'},{...home,HOUSEKEEPING_REMINDER_CRON_ENABLED:'false'},{...home,VERCEL_PROJECT_ID:''}])assert.deepEqual(buildVercelConfig(env).crons,[]);
});
test('cron configuration preserves static output and private page security headers without embedding credentials',()=>{
  const config=buildVercelConfig({...home,CRON_SECRET:'SYNTHETIC-SECRET-NEVER-IN-CONFIG'});
  assert.equal(config.outputDirectory,'dist');assert.equal(config.cleanUrls,true);assert.equal(config.trailingSlash,false);
  assert.match(config.headers.find(h=>h.source==='/(.*)').headers.find(h=>h.key==='Content-Security-Policy').value,/frame-ancestors 'none'/);
  assert.match(config.headers.find(h=>h.source==='/housekeeping/(.*)').headers.find(h=>h.key==='Cache-Control').value,/no-store/);
  assert.match(config.headers.find(h=>h.source==='/admin/(.*)').headers.find(h=>h.key==='Cache-Control').value,/no-store/);
  assert.ok(!JSON.stringify(config).includes('SYNTHETIC-SECRET'));
});
