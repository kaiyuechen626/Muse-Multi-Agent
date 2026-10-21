// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
test('消息编辑与重新生成分支：原文保留、上下文截断、版本检查',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-revision-'));
 const server=await createApp({dataDir:root,provider:async()=>({content:'新回答',finishReason:'stop'})});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}/api/`;
 const req=(p,method='GET',body)=>fetch(base+p,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...a)=>(await req(...a)).json();
 try{
 await json('settings','PUT',{apiKey:'test'});
 const role=await json('characters','POST',{name:'测试',greeting:'开场白'});
 let chat=await json('chats','POST',{characterId:role.id});
 chat=await json(`chats/${chat.id}/messages`,'POST',{content:'原问题'});
 const original=structuredClone(chat),path=`chats/${chat.id}/revision`;
 const edit=await json(path,'POST',{action:'edit',messageId:chat.messages[1].id,updatedAt:chat.updatedAt,content:'新问题'});
 assert.notEqual(edit.id,chat.id);assert.equal(edit.messages.length,2);assert.equal(edit.messages[1].content,'新问题');
 assert.equal(edit.parentChatId,chat.id);assert.equal(edit.parentMessageId,chat.messages[1].id);assert.equal(edit.branchAction,'edit');
 const regen=await json(path,'POST',{action:'regenerate',messageId:chat.messages[2].id,updatedAt:chat.updatedAt});
 assert.equal(regen.messages.length,2);assert.equal(regen.messages[1].content,'原问题');assert.equal(regen.parentChatId,chat.id);assert.equal(regen.branchAction,'regenerate');
 const answer=await json(`chats/${regen.id}/messages`,'POST',{retry:true});assert.equal(answer.messages.at(-1).content,'新回答');
 const unchanged=await json(`chats/${chat.id}`);delete unchanged.generating;assert.deepEqual(unchanged,original);
 assert.equal((await req(path,'POST',{action:'edit',messageId:chat.messages[1].id,updatedAt:0,content:'冲突'})).status,409);
 assert.equal((await req(path,'POST',{action:'regenerate',messageId:chat.messages[0].id,updatedAt:chat.updatedAt})).status,400);
 assert.equal((await req(path,'POST',{action:'edit',messageId:chat.messages[1].id,updatedAt:chat.updatedAt,content:' '})).status,400);
 const summaries=await json('chats');assert.equal(summaries.find(c=>c.id===edit.id).parentChatId,chat.id);
 await req(`chats/${chat.id}`,'DELETE');assert.equal((await json(`chats/${edit.id}`)).messages[1].content,'新问题');
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
