// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memoryContextSnapshot,memoryPrompt} from '../src/memory.mjs';
import {createApp} from '../src/server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
test('快照与提示词一致，排除删除、过期及超预算项',()=>{
 const memory={records:[{id:'a',text:'茶',importance:2},{id:'b',text:'很长的文字',importance:1},{id:'c',text:'过期',validUntil:1},{id:'d',text:'已删除',deletedAt:1}]};
 const result=memoryContextSnapshot(memory,4,100);assert.deepEqual(result.trace.records.map(r=>r.id),['a']);assert.equal(result.trace.expired,1);assert.equal(result.trace.budgetSkipped,1);assert.match(result.prompt,/- 茶$/);assert.equal(memoryPrompt(memory,4),result.prompt);
 memory.records[0].text='改变';assert.equal(result.trace.records[0].text,'茶');assert.equal(memoryContextSnapshot(null).trace.records.length,0);
});
test('回复快照持久化，与实际上下文一致；导出不泄露，人工编辑移除追踪',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-trace-'));let context,server,base;
 async function start(){server=await createApp({dataDir:root,provider:async role=>{context=role.memoryContext;return {content:'测试回答',finishReason:'stop'};}});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(r=>server.close(r));const req=(p,method='GET',body)=>fetch(base+p,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const json=async(...a)=>(await req(...a)).json();
 await start();try{
 await json('settings','PUT',{apiKey:'test'});const role=await json('characters','POST',{name:'测试'}),path=`characters/${role.id}/memories`;
 const memory=await json(path,'POST',{text:'测试记忆原文'}),record=memory.records[0];let chat=await json('chats','POST',{characterId:role.id});
 chat=await json(`chats/${chat.id}/messages`,'POST',{content:'你好'});const answer=chat.messages.at(-1);assert.equal(answer.memoryTrace.records[0].text,'测试记忆原文');assert.ok(context.includes(answer.memoryTrace.records[0].text));
 await json(path+'/'+record.id,'PUT',{revision:record.revision,text:'更新后的记忆'});
 await stop();await start();chat=await json(`chats/${chat.id}`);assert.equal(chat.messages.at(-1).memoryTrace.records[0].text,'测试记忆原文');
 const exported=await json(`chats/${chat.id}/export`);assert.equal(exported.messages.at(-1).memoryTrace,undefined);
 const edit=await json(`chats/${chat.id}/revision`,'POST',{updatedAt:chat.updatedAt,messageId:answer.id,action:'edit',content:'人工改写'});assert.equal(edit.messages.at(-1).memoryTrace,undefined);
 }finally{await stop();await rm(root,{recursive:true,force:true});}
});
