// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateSummary,needsSummary,summaryHistory,validSummary} from '../src/chat-summary.mjs';
import {createApp} from '../src/server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
const messages=()=>Array.from({length:40},(_,i)=>({id:String(i),role:i%2?'assistant':'user',content:`测试原文${i}`,createdAt:1}));
test('摘要覆盖校验、近期原文保留、增量及禁用',async()=>{
 const chat={messages:messages()};assert.equal(needsSummary(chat),true);
 chat.summary=await generateSummary(chat,'test',async()=>({content:'已有事件',finishReason:'stop'}));assert.equal(chat.summary.coveredCount,20);assert.equal(validSummary(chat),true);
 assert.equal(summaryHistory(chat).length,21);assert.equal(needsSummary(chat),false);assert.equal(chat.messages.length,40);
 chat.summaryEnabled=false;assert.equal(summaryHistory(chat),chat.messages);assert.equal(needsSummary(chat),false);delete chat.summaryEnabled;
 chat.messages[0].content='改写';assert.equal(validSummary(chat),false);assert.equal(summaryHistory(chat),chat.messages);
 await assert.rejects(generateSummary(chat,'test',async()=>({content:'未完成',finishReason:'length'})));
});
test('摘要 API：自动压缩、原文持久化、编辑开关与失败回退',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-summary-'));let seen,fail=false;
 const server=await createApp({dataDir:root,provider:async(role,history)=>{if(role.name==='聊天摘要助手'){if(fail)throw new Error('模拟失败');return {content:'人物约定一起读书',finishReason:'stop'};}seen=structuredClone(history);return {content:'新回答',finishReason:'stop'};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/`;
 const req=(p,method='GET',body)=>fetch(base+p,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const json=async(...a)=>(await req(...a)).json();
 try{
 await json('settings','PUT',{apiKey:'test'});const role=await json('characters','POST',{name:'角色'});
 const backup={schemaVersion:1,title:'长对话',createdAt:1,updatedAt:1,messages:messages()};
 let c=(await json('chats/import','POST',{characterId:role.id,chat:backup})).chat;
 c=await json(`chats/${c.id}/messages`,'POST',{content:'继续'});assert.equal(c.messages.length,42);assert.equal(c.summary.coveredCount,20);assert.equal(seen.length,22);assert.equal(seen[0].role,'system');
 c=await json(`chats/${c.id}/summary`,'PUT',{updatedAt:c.updatedAt,text:'人工修正'});assert.equal(c.summary.edited,true);
 assert.equal((await req(`chats/${c.id}/summary`,'PUT',{updatedAt:0,text:'过期'})).status,409);
 c=await json(`chats/${c.id}/summary`,'PUT',{updatedAt:c.updatedAt,enabled:false});c=await json(`chats/${c.id}/messages`,'POST',{content:'继续'});assert.equal(seen.length,43);
 fail=true;let other=(await json('chats/import','POST',{characterId:role.id,chat:{...backup,title:'失败回退'}})).chat;other=await json(`chats/${other.id}/messages`,'POST',{content:'继续'});assert.equal(seen.length,41);assert.ok(other.summaryError);assert.equal(other.messages.length,42);assert.equal(other.summary,undefined);
 const saved=await json(`chats/${c.id}`);assert.equal(saved.messages[0].content,'测试原文0');assert.equal(saved.summary.text,'人工修正');
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
