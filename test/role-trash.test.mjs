// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
import {Store} from '../src/store.mjs';
test('角色回收站：保留身份与记忆、阻止调用、重启恢复及彻底删除范围',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'muse-role-trash-')),store=new Store(dataDir);let server,base;
 async function start(){server=await createApp({dataDir,provider:async()=>({content:'恢复后回答',finishReason:'stop'})});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(resolve=>server.close(resolve));
 const req=(path,method='GET',body)=>fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>{const r=await req(...args);assert.ok(r.ok,await r.clone().text());return r.json();};
 try{
  await start();await json('settings','PUT',{apiKey:'test-only'});
  const role=await json('characters','POST',{name:'回收测试',persona:'原人设',greeting:'原开场白',pinned:true,avatar:'data:image/png;base64,YQ=='});
  const chat=await json('chats','POST',{characterId:role.id});await json(`characters/${role.id}/memories`,'POST',{text:'用户喜欢茶'});
  const memory=await store.get('memories',role.id);
  assert.equal((await req(`characters/${role.id}/purge`,'DELETE',{updatedAt:role.updatedAt})).status,409);
  await json(`characters/${role.id}`,'DELETE',{updatedAt:role.updatedAt});assert.equal((await json('characters')).length,0);
  let deleted=(await json('characters?trash=1'))[0];assert.equal(deleted.id,role.id);
  for(const suffix of ['/memories','/export'])assert.equal((await req(`characters/${role.id}${suffix}`)).status,404);
  assert.equal((await req(`characters/${role.id}`,'PUT',{name:'不能修改'})).status,404);
  assert.equal((await req('chats','POST',{characterId:role.id})).status,404);
  assert.equal((await req(`chats/${chat.id}/messages`,'POST',{content:'测试'})).status,409);
  assert.equal((await json(`chats/${chat.id}`)).messages[0].content,'原开场白');
  assert.equal((await json('backup')).characters[0].deletedAt,deleted.deletedAt);
  await stop();await start();deleted=(await json('characters?trash=1'))[0];
  await json(`characters/${role.id}/restore`,'POST',{updatedAt:deleted.updatedAt});const restored=(await json('characters'))[0];
  assert.equal(restored.id,role.id);assert.equal(restored.avatar,role.avatar);assert.equal(restored.pinned,true);assert.deepEqual(await store.get('memories',role.id),memory);
  await json('settings','PUT',{apiKey:'test-only'});await json(`chats/${chat.id}/messages`,'POST',{content:'恢复了'});
  await json(`characters/${role.id}`,'DELETE',{updatedAt:restored.updatedAt});deleted=(await json('characters?trash=1'))[0];
  await json(`characters/${role.id}/purge`,'DELETE',{updatedAt:deleted.updatedAt});assert.equal(await store.get('characters',role.id),null);assert.equal(await store.get('memories',role.id),null);assert.ok(await store.get('chats',chat.id));
 }finally{if(server?.listening)await stop();await rm(dataDir,{recursive:true,force:true});}
});
