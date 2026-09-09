import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changes,fingerprint,replaceTasks,board} from './bridge.mjs';
const task={id:'WIS-001',title:'Settings',status:'queued',priority:1,notes:'',updatedAt:'2026-09-08T00:00:00.000Z'};
const state={version:1,paused:false,tasks:[task],handled:{}};
test('ignores bot messages and unapproved authors; detects owner edits',()=>{
 const m={ts:'123.456',text:'Build settings',user:'owner'};
 assert.equal(changes([m,{...m,user:'other'},{...m,bot_id:'B1'}],{},'C1','owner').length,1);
 const handled={'C1:123.456':fingerprint(m)};
 assert.equal(changes([m],handled,'C1','owner').length,0);
 assert.equal(changes([{...m,text:'Change settings'}],handled,'C1','owner').length,1);
 assert.equal(changes([{...m,reply_count:1,latest_reply:'124.000'}],handled,'C1','owner').length,0);
});
test('rejects stale writes, dropped tasks, duplicate IDs and concurrent builds',()=>{
 assert.throws(()=>replaceTasks(state,{version:0}));
 assert.throws(()=>replaceTasks(state,{version:1,tasks:[]}));
 assert.throws(()=>replaceTasks(state,{version:1,tasks:[task,task]}));
 assert.throws(()=>replaceTasks(state,{version:1,tasks:[{...task,status:'building'},{...task,id:'WIS-002',status:'building'}]}));
});
test('acknowledgement preserves existing receipts and increments revision',()=>{
 const next=replaceTasks({...state,handled:{a:'old'}},{version:1,handled:{b:'new'}});
 assert.deepEqual(next.handled,{a:'old',b:'new'}); assert.equal(next.version,2);
});
test('board escapes Slack mention/link markup and preserves done status',()=>{
 const text=board({...state,tasks:[{...task,title:'Fix <!channel> & <https://evil.test>',status:'done'}]});
 assert.ok(!text.includes('<!channel>')); assert.ok(text.includes('Done')); assert.ok(text.includes('&lt;'));
});
