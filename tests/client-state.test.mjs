import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvailabilityCache } from '../js/availability-state.js';
import { runBusyAction } from '../admin/action-state.js';
test('failed calendar API produces unknown and retries, successful stale data expires',async()=>{
  let fail=true,now=0,reads=0;
  const cache=createAvailabilityCache(async()=>{reads++;if(fail)throw new Error('offline');return new Map();},30,()=>now);
  await assert.rejects(cache.load('2026-11'));assert.equal(cache.state('2026-11-01'),'unknown');
  fail=false;await cache.load('2026-11');assert.equal(cache.state('2026-11-01'),'available');
  now=31;assert.equal(cache.state('2026-11-01'),'unknown');fail=true;
  await assert.rejects(cache.load('2026-11'));assert.equal(cache.state('2026-11-01'),'unknown');
  fail=false;await cache.load('2026-11');assert.equal(reads,4);
});
test('busy action ignores double submission, restores controls on failure and leaves input intact',async()=>{
  const button={disabled:false},input={value:'keep this input'};
  const root={querySelectorAll:()=>[button],setAttribute(){},removeAttribute(){}};
  let resolve,calls=0,error;
  const work=()=>{calls++;return new Promise(r=>resolve=r);};
  const first=runBusyAction('save',root,work,e=>error=e);assert.equal(button.disabled,true);
  await runBusyAction('save',root,work,e=>error=e);assert.equal(calls,1);resolve();await first;assert.equal(button.disabled,false);
  await runBusyAction('save',root,()=>{throw new Error('offline');},e=>error=e);
  assert.equal(error.message,'offline');assert.equal(input.value,'keep this input');assert.equal(button.disabled,false);
});
test('older calendar response cannot replace a newer failure or a cleared cache',async()=>{
  let resolve;
  const cache=createAvailabilityCache(()=>new Promise(r=>resolve=r));
  const pending=cache.load('2026-11');cache.clear();resolve(new Map());await pending;
  assert.equal(cache.state('2026-11-01'),'unknown');
  let firstResolve,reads=0;
  const racing=createAvailabilityCache(()=>++reads===1?new Promise(r=>firstResolve=r):Promise.reject(new Error('newer failure')));
  const older=racing.load('2026-11');await assert.rejects(racing.load('2026-11',{force:true}));firstResolve(new Map());await older;
  assert.equal(racing.state('2026-11-01'),'unknown');
});
