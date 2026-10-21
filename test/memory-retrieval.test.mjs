// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memoryContextSnapshot} from '../src/memory.mjs';
import {createApp} from '../src/server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
test('话题优先、限额、删除过期过滤、回退和关闭',()=>{
 const records=Array.from({length:20},(_,i)=>({id:`a${i}`,text:`用户的旅行计划${i}`,importance:10}));records.push({id:'tea',text:'用户喝无糖茶',importance:0},{id:'old',text:'茶',validUntil:1},{id:'gone',text:'茶',deletedAt:1});
 const result=memoryContextSnapshot({records},24000,100,'喝什么茶');assert.equal(result.trace.records[0].id,'tea');assert.equal(result.trace.records[0].selectionReason,'话题匹配');assert.ok(result.trace.records.length<=15);assert.ok(result.trace.used<=8000);assert.ok(!result.prompt.includes('- 茶'));
 const fallback=memoryContextSnapshot({records},24000,100,'hello');assert.equal(fallback.trace.selection,'fallback');assert.equal(fallback.trace.records.length,5);
 const disabled=memoryContextSnapshot({records,retrievalEnabled:false},24000,100,'茶');assert.equal(disabled.trace.selection,undefined);assert.equal(disabled.trace.records.length,21);
 const small=memoryContextSnapshot({records},12,100,'茶');assert.ok(small.trace.used<=12);
 const generic=memoryContextSnapshot({records:[{id:'tea',text:'用户喜欢茶'},{id:'book',text:'用户喜欢阅读'}]},8000,100,'我不喜欢茶');assert.equal(generic.trace.records.find(r=>r.id==='book').selectionReason,'基础记忆补充');
});
test('跨聊天同角色检索、隔离、开关和备份追踪',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-retrieval-'));let captured;
 const server=await createApp({dataDir:root,provider:async r=>{captured=r.memoryContext;return {content:'模拟回复',finishReason:'stop'};}});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}/api/`,json=async(p,method='GET',body)=>{const r=await fetch(base+p,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r.json();};
 try{await json('settings','PUT',{apiKey:'test-only'});const a=await json('characters','POST',{name:'A'}),b=await json('characters','POST',{name:'B'});
  await json(`characters/${a.id}/memories`,'POST',{text:'用户喜欢无糖茶'});await json(`characters/${b.id}/memories`,'POST',{text:'其他角色秘密茶'});
  await json('chats','POST',{characterId:a.id});let chat=await json('chats','POST',{characterId:a.id});chat=await json(`chats/${chat.id}/messages`,'POST',{content:'聊聊无糖茶'});
  assert.ok(captured.includes('用户喜欢无糖茶'));assert.ok(!captured.includes('秘密'));assert.equal(chat.messages.at(-1).memoryTrace.selection,'topic');
  await json(`characters/${a.id}/memories/retrieval`,'PUT',{enabled:false});assert.equal((await json(`characters/${a.id}/memories`)).retrievalEnabled,false);
  const backup=await json('backup');assert.equal(backup.memories.find(m=>m.id===a.id).retrievalEnabled,false);assert.equal(backup.chats.find(c=>c.id===chat.id).messages.at(-1).memoryTrace.records[0].selectionReason,'话题匹配');
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
