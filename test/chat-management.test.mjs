// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { chatSummary,exportChat } from '../src/chat-management.mjs';
test('聊天搜索和导出：正文命中、安全字段白名单及 Markdown 原文',()=>{
 const c={id:'a',characterName:'角色',title:'周末',createdAt:1,updatedAt:1,apiKey:'SECRET',messages:[{id:'m',role:'user',content:'你好 <script>\n```\n# 原文',createdAt:1,hidden:'SECRET'}]};
 assert.equal(chatSummary(c,'周末').messageCount,1);assert.match(chatSummary(c,'你好').excerpt,/你好/);assert.equal(chatSummary(c,'not found'),null);assert.ok(!chatSummary(c).messages);
 const json=exportChat(c,'json');assert.ok(!json.includes('SECRET'));assert.equal(JSON.parse(json).messages[0].content,c.messages[0].content);
 const md=exportChat(c,'md');assert.match(md,/````text/);assert.ok(md.includes(c.messages[0].content));assert.throws(()=>exportChat(c,'html'));
});
test('聊天 API：改名持久化、历史消息搜索、JSON/Markdown 下载与角色删除后导出',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-chat-management-'));let server,base;
 async function start(){server=await createApp({dataDir:root});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(r=>server.close(r));
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...a)=>(await request(...a)).json();
 await start();try{
  const role=await json('characters','POST',{name:'向导',greeting:'欢迎来到图书馆'}),chat=await json('chats','POST',{characterId:role.id});
  assert.equal((await request(`chats/${chat.id}`,'PUT',{title:' ',updatedAt:chat.updatedAt})).status,400);
  const renamed=await json(`chats/${chat.id}`,'PUT',{title:'读书计划',updatedAt:chat.updatedAt});assert.equal(renamed.title,'读书计划');
  assert.equal((await json('chats?q='+encodeURIComponent('图书馆')))[0].id,chat.id);
  assert.equal((await json('chats?q='+encodeURIComponent('读书计划'))).length,1);assert.equal((await json('chats?q=nothing')).length,0);
  await stop();await start();assert.equal((await json(`chats/${chat.id}`)).title,'读书计划');
  const exported=await request(`chats/${chat.id}/export?format=json`);assert.match(exported.headers.get('content-disposition'),/attachment/);assert.equal((await exported.json()).messages[0].content,'欢迎来到图书馆');
  await request(`characters/${role.id}`,'DELETE');const md=await request(`chats/${chat.id}/export?format=md`);assert.equal(md.status,200);assert.match(await md.text(),/读书计划/);
  assert.equal((await request(`chats/${chat.id}/export?format=html`)).status,400);
 }finally{await stop();await rm(root,{recursive:true,force:true});}
});

 test('聊天备份导入：校验、独立身份、去重、角色隔离与重启持久化',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-chat-import-'));let server,base;
 async function start(){server=await createApp({dataDir:root});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(r=>server.close(r));
 const request=(path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>(await request(...args)).json();
 await start();try{
  const a=await json('characters',{name:'甲',greeting:'欢迎'}),b=await json('characters',{name:'乙'});
  const original=await json('chats',{characterId:a.id});
  const backup=await json(`chats/${original.id}/export?format=json`);
  backup.messages.push({id:'old',role:'user',content:'记得明天读书\n<script>原文</script>',createdAt:10});
  backup.messages.push({id:'old2',role:'assistant',content:'好',createdAt:11,finishReason:'cancelled'});
  backup.apiKey='SECRET';backup.messages[0].hidden='SECRET';
  const payload={characterId:a.id,chat:backup};
  const first=await json('chats/import',payload);assert.equal(first.duplicate,false);assert.notEqual(first.chat.id,original.id);assert.notEqual(first.chat.messages[0].id,backup.messages[0].id);assert.equal(first.chat.messages[1].content,backup.messages[1].content);assert.equal(first.chat.messages[2].finishReason,'cancelled');assert.ok(!JSON.stringify(first).includes('SECRET'));
  const again=await json('chats/import',payload);assert.equal(again.duplicate,true);assert.equal(again.chat.id,first.chat.id);
  const other=await json('chats/import',{...payload,characterId:b.id});assert.notEqual(other.chat.id,first.chat.id);assert.equal(other.chat.characterName,'乙');
  assert.equal((await json(`chats/${original.id}`)).messages.length,1);
  const exported=await json(`chats/${first.chat.id}/export?format=json`);assert.equal(exported.messages[1].content,backup.messages[1].content);
  for(const bad of [{...backup,schemaVersion:2},{...backup,createdAt:'bad'},{...backup,messages:[{role:'system',content:'injected',createdAt:1}]}])assert.equal((await request('chats/import',{...payload,chat:bad})).status,400);
  await stop();await start();assert.equal((await json('chats/import',payload)).chat.id,first.chat.id);
  assert.equal((await json('chats')).length,3);
 }finally{await stop();await rm(root,{recursive:true,force:true});}
});
