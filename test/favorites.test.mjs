// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
import {addReplyVersion,selectReplyVersion} from '../src/reply-versions.mjs';
import {importChat,exportChat} from '../src/chat-management.mjs';
test('收藏持久化、搜索、并发校验、分支、回收站及备份',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'muse-favorites-'));let server,base;
 async function start(){server=await createApp({dataDir});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(resolve=>server.close(resolve));
 const req=(path,method='GET',body)=>fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>{const r=await req(...args);assert.ok(r.ok,await r.clone().text());return r.json();};
 try{
  await start();const role=await json('characters','POST',{name:'收藏角色',greeting:'记得喝茶 <script>alert(1)</script>'});let chat=await json('chats','POST',{characterId:role.id});const messageId=chat.messages[0].id;
  const stale=chat.updatedAt;chat=await json(`chats/${chat.id}/favorite`,'PUT',{messageId,updatedAt:chat.updatedAt,enabled:true});
  assert.ok(chat.messages[0].favoriteAt);assert.equal((await req(`chats/${chat.id}/favorite`,'PUT',{messageId,updatedAt:stale,enabled:false})).status,409);
  assert.equal((await json('favorites?q=喝茶')).total,1);assert.equal((await json('favorites?q=收藏角色')).total,1);assert.equal((await json('favorites?q=不存在')).total,0);
  assert.equal((await req('favorites?offset=-1')).status,400);
  const backup=await json('backup');assert.equal(backup.chats[0].messages[0].favoriteAt,chat.messages[0].favoriteAt);
  const imported=importChat(JSON.parse(exportChat(chat,'json')),role);assert.equal(imported.messages[0].favoriteAt,chat.messages[0].favoriteAt);
  const branch=await json(`chats/${chat.id}/revision`,'POST',{messageId,updatedAt:chat.updatedAt,action:'edit',content:'新的内容'});assert.equal(branch.messages[0].favoriteAt,undefined);
  await stop();await start();assert.equal((await json('favorites')).total,1);
  await json(`chats/${chat.id}`,'DELETE',{updatedAt:chat.updatedAt});assert.equal((await json('favorites')).total,0);
  const deleted=(await json('chats?trash=1'))[0];await json(`chats/${chat.id}/restore`,'POST',{updatedAt:deleted.updatedAt});assert.equal((await json('favorites')).total,1);
  chat=await json(`chats/${chat.id}`);await json(`chats/${chat.id}/favorite`,'PUT',{messageId,updatedAt:chat.updatedAt,enabled:false});assert.equal((await json('favorites')).total,0);
 }finally{if(server?.listening)await stop();await rm(dataDir,{recursive:true,force:true});}
});
test('收藏跟随同一回复的版本切换',()=>{
 const original={id:'reply',role:'assistant',content:'A',createdAt:1,favoriteAt:123};
 const message=addReplyVersion(original,{content:'B',createdAt:2});assert.equal(message.favoriteAt,123);
 const chat=selectReplyVersion({messages:[message],updatedAt:2},'reply',0);assert.equal(chat.messages[0].favoriteAt,123);assert.equal(chat.messages[0].content,'A');
});
