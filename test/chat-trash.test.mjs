// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
test('聊天回收站：隐藏、禁止操作、重启、恢复、备份及永久删除',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'muse-trash-test-'));let server,base;
 async function start(){server=await createApp({dataDir});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(resolve=>server.close(resolve));
 const req=(path,method='GET',body)=>fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>{const r=await req(...args);assert.ok(r.ok,await r.clone().text());return r.json();};
 try{
  await start();const role=await json('characters','POST',{name:'测试角色',greeting:'保留消息'});let chat=await json('chats','POST',{characterId:role.id});
  chat=await json(`chats/${chat.id}/organization`,'PUT',{updatedAt:chat.updatedAt,pinned:true,archived:true});
  assert.equal((await req(`chats/${chat.id}/purge`,'DELETE',{updatedAt:chat.updatedAt})).status,409);
  await json(`chats/${chat.id}`,'DELETE',{updatedAt:chat.updatedAt});
  assert.equal((await json('chats')).length,0);assert.equal((await json('chats?q=保留')).length,0);
  let deleted=(await json('chats?trash=1'))[0];assert.equal(deleted.id,chat.id);
  for(const suffix of ['', '/export'])assert.equal((await req(`chats/${chat.id}${suffix}`)).status,409);
  assert.equal((await req(`chats/${chat.id}/messages`,'POST',{content:'不能发送'})).status,409);
  assert.equal((await req(`chats/${chat.id}/restore`,'POST',{updatedAt:chat.updatedAt})).status,409);
  const backup=await json('backup');assert.equal(backup.chats[0].deletedAt,deleted.deletedAt);assert.equal(backup.chats[0].messages[0].content,'保留消息');
  await stop();await start();deleted=(await json('chats?trash=1'))[0];
  await json(`chats/${chat.id}/restore`,'POST',{updatedAt:deleted.updatedAt});chat=await json(`chats/${chat.id}`);
  assert.equal(chat.pinned,true);assert.equal(chat.archived,true);assert.equal(chat.messages[0].content,'保留消息');assert.equal((await json('chats?trash=1')).length,0);
  await json(`chats/${chat.id}`,'DELETE',{updatedAt:chat.updatedAt});deleted=(await json('chats?trash=1'))[0];
  await json(`chats/${chat.id}/purge`,'DELETE',{updatedAt:deleted.updatedAt});assert.equal((await req(`chats/${chat.id}`)).status,404);
  assert.equal((await json('chats?trash=1')).length,0);assert.equal((await json('characters')).length,1);
 }finally{if(server?.listening)await stop();await rm(dataDir,{recursive:true,force:true});}
});
