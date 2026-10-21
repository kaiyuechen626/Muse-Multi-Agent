// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {convertBackup, stableId, mergeRecords, memoriesFor} from '../src/bridge.mjs';
const fixture = () => ({
  assistants:[{id:'default',name:'Cyrene',useGlobalMemory:true},{id:'reviewer',name:'Cyrene'}],
  sessions:[{id:'s',assistantId:'default',title:'probe'}],
  messages:[{id:'m1',sessionId:'s',role:'USER',content:'hello',createdAt:10,seq:1},
    {id:'m2',sessionId:'s',role:'ASSISTANT',content:'hi',createdAt:5,seq:2,commitSeq:2,parentMessageId:'m1',parentGroupId:'branch-a',toolCallsJson:'[]'}],
  facts:[{id:1,scope:'main',fact:'private A',spaceId:'work'}],
  scopedFacts:{reviewer:[{id:1,scope:'reviewer',fact:'private B',spaceId:'work'}]},
});
test('stable identity survives rename, same-name roles stay distinct and libraries separate',()=>{
  const a=fixture();const first=convertBackup(a,'paired-library');a.assistants[0].name='renamed';
  assert.equal(first.roles[0].id,convertBackup(a,'paired-library').roles[0].id);
  assert.notEqual(first.roles[0].id,first.roles[1].id);
  assert.notEqual(first.roles[0].id,convertBackup(a,'another-library').roles[0].id);
});
test('card with erased id fails instead of guessing identity',()=>{
  const a=fixture();a.assistants[0].id='';assert.throws(()=>convertBackup(a,'lib'),/identity/);
});
test('branch, sequence, source extensions survive conversion',()=>{
  const b=convertBackup(fixture(),'lib');assert.equal(b.messages[1].parentMessageId,b.messages[0].id);
  assert.equal(b.messages[1].seq,2);assert.equal(b.messages[1].extensions.muse.parentGroupId,'branch-a');
});
test('database-local memory ids do not collide and roles/spaces stay isolated',()=>{
  const b=convertBackup(fixture(),'lib');assert.notEqual(b.memories[0].id,b.memories[1].id);
  assert.deepEqual(memoriesFor(b,b.roles[0].id,stableId('lib','space','work')).map(m=>m.text),['private A']);
  assert.deepEqual(memoriesFor(b,b.roles[0].id,stableId('lib','space','life')),[]);
});
test('repeated import is idempotent and conflicting update fails explicitly',()=>{
  const b=convertBackup(fixture(),'lib');assert.deepEqual(mergeRecords(b.messages,b.messages),b.messages);
  assert.throws(()=>mergeRecords(b.messages,[{...b.messages[0],content:'changed'}]),/Conflict/);
});
test('global memory is opt-in, disabled memory fails closed',()=>{
  const b=convertBackup(fixture(),'lib');const space=stableId('lib','space','work');
  assert.deepEqual(memoriesFor(b,b.roles[1].id,space).map(m=>m.text),['private B']);
  b.roles[1].memoryPolicy.useGlobal=true;
  assert.equal(memoriesFor(b,b.roles[1].id,space).length,2);
  b.roles[1].memoryPolicy.enabled=false;
  assert.deepEqual(memoriesFor(b,b.roles[1].id,space),[]);
  b.roles[0].memoryPolicy.useGlobal=false;
  assert.deepEqual(memoriesFor(b,b.roles[0].id,space),[]);
});
test('missing roles, parents, duplicate identity and unsafe integer are rejected',()=>{
  let a=fixture();a.sessions[0].assistantId='unknown';assert.throws(()=>convertBackup(a,'lib'),/Unmapped/);
  a=fixture();a.messages[1].parentMessageId='missing';assert.throws(()=>convertBackup(a,'lib'),/parent/);
  a=fixture();a.messages.push(a.messages[0]);assert.throws(()=>convertBackup(a,'lib'),/Duplicate/);
  a=fixture();a.facts[0].id=9007199254740992;assert.throws(()=>convertBackup(a,'lib'),/Unsafe/);
});
