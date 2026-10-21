// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBackupMemories,memoryPrompt,changeMemory } from '../src/memory.mjs';
import { createApp } from '../src/server.mjs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { promptMessages,character } from '../src/characters.mjs';
test('备份记忆：JSON 和 NDJSON、角色隔离、去重与认证字段排除',()=>{
 const backup={exportedAt:1,assistants:[{id:'default',name:'主角色'},{id:'other',name:'其他角色'}],facts:[{id:1,fact:'喜欢茶'},{id:2,fact:'喜欢咖啡',scope:'other'}],scopedFacts:{other:[{id:1,fact:'喜欢读书'}]},settings:{apiKey:'secret'}};
 const a=readBackupMemories(JSON.stringify(backup),'default');assert.equal(a.records.length,1);assert.equal(a.records[0].text,'喜欢茶');assert.ok(!JSON.stringify(a).includes('secret'));
 const b=readBackupMemories(JSON.stringify(backup),'other');assert.equal(b.records.length,2);
 const text=[{type:'meta',exportedAt:1},{type:'assistant',data:backup.assistants[0]},...backup.facts.map(data=>({type:'fact',data}))].map(JSON.stringify).join('\n');assert.deepEqual(readBackupMemories(text,'default'),a);
 assert.throws(()=>readBackupMemories(text,'missing'),/找不到/);
});
test('记忆修改保留来源，删除不再注入，过期编辑版本被拒绝',()=>{
 const original={records:[{id:'abc',text:'旧内容',sourceId:'phone-id',sourceScope:'main',importance:3}]};
 const edited=changeMemory(original,'PUT','abc',{text:'新内容',revision:0});assert.equal(edited.records[0].sourceId,'phone-id');assert.equal(original.records[0].text,'旧内容');
 assert.throws(()=>changeMemory(edited,'PUT','abc',{text:'覆盖',revision:0}),/其他窗口/);
 assert.throws(()=>changeMemory(edited,'POST',null,{text:'  '}),/记忆内容/);
 const deleted=changeMemory(edited,'DELETE','abc',{revision:1});assert.equal(memoryPrompt(deleted),'');assert.equal(deleted.records[0].text,'新内容');
});
test('记忆 API：新增编辑删除、重启恢复、其他角色隔离及模型上下文',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-memory-crud-'));let server,base,seen;
 async function start(){server=await createApp({dataDir:dir,provider:async(role)=>{seen=role.memoryContext;return {content:'收到',finishReason:'stop'};}});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(resolve=>server.close(resolve));
 async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 await start();try{
  const a=(await api('characters','POST',{name:'A'})).data,b=(await api('characters','POST',{name:'B'})).data;
  const path=`characters/${a.id}/memories`;
  const added=await api(path,'POST',{text:'喜欢喝茶'});assert.equal(added.status,200);const record=added.data.records[0];assert.equal(record.source,'local');
  const edited=await api(`${path}/${record.id}`,'PUT',{text:'喜欢无糖茶',revision:record.revision});assert.equal(edited.data.records[0].text,'喜欢无糖茶');
  assert.equal((await api(`${path}/${record.id}`,'PUT',{text:'过期修改',revision:record.revision})).status,400);
  assert.equal((await api(`characters/${b.id}/memories`)).data.records.length,0);
  await stop();await start();assert.equal((await api(path)).data.records[0].text,'喜欢无糖茶');
  await api('settings','PUT',{apiKey:'fake'});const chat=(await api('chats','POST',{characterId:a.id})).data;
  await api(`chats/${chat.id}/messages`,'POST',{content:'你好'});assert.match(seen,/喜欢无糖茶/);
  await api(`${path}/${record.id}`,'DELETE',{revision:2});assert.equal((await api(path)).data.records.length,0);
  await api(`chats/${chat.id}/messages`,'POST',{content:'继续'});assert.equal(seen,'');
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
test('记忆上下文：预算、过期过滤、进入请求但不修改历史',()=>{
 const memory={records:[{text:'喜欢茶',importance:1},{text:'过期',validUntil:1,importance:9}]};
 const context=memoryPrompt(memory);assert.match(context,/喜欢茶/);assert.ok(!context.includes('- 过期'));assert.equal(memoryPrompt(memory,1),'');assert.equal(memoryPrompt(null),'');
 const role={...character({name:'测试'}),memoryContext:context},history=[{role:'user',content:'你好'}];const messages=promptMessages(role,history);assert.equal(messages[1].content,context);assert.equal(history.length,1);
});

test('记忆导出：字段白名单、删除过滤、过期标记及原文保留',async()=>{
 const {exportMemory}=await import('../src/memory.mjs');
 const role={id:'role',name:'角色',apiKey:'SECRET',persona:'PERSONA'};
 const memory={settings:{apiKey:'SECRET'},records:[{id:'one',text:'喜欢茶\n也喜欢读书',importance:2,sourceId:'phone',hidden:'SECRET'},{id:'expired',text:'曾经的偏好',validUntil:1},{id:'deleted',text:'DELETED',deletedAt:1}]};
 const exported=exportMemory(memory,role,'json',100);
 assert.ok(!exported.includes('SECRET'));assert.ok(!exported.includes('PERSONA'));assert.ok(!exported.includes('DELETED'));
 const data=JSON.parse(exported);assert.equal(data.format,'muse-memory');assert.equal(data.records.length,2);assert.equal(data.records[0].text,memory.records[0].text);assert.equal(data.records[0].sourceId,'phone');
 const txt=exportMemory(memory,role,'txt',100);assert.match(txt,/\[已过期\] 曾经的偏好/);assert.ok(txt.includes(memory.records[0].text));assert.throws(()=>exportMemory(memory,role,'html'));
 assert.equal(JSON.parse(exportMemory(null,role,'json')).records.length,0);
});

test('记忆导出接口：角色隔离、附件响应、空记忆和无效格式',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-memory-export-'));
 const server=await createApp({dataDir:dir});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}/api/`;
 const request=(path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 try{
  const a=await (await request('characters',{name:'A'})).json(),b=await (await request('characters',{name:'B'})).json();
  await request(`characters/${a.id}/memories`,{text:'只属于 A 的记忆'});
  const response=await request(`characters/${a.id}/memories/export?format=json`);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal(response.headers.get('cache-control'),'no-store');
  const backup=await response.json();assert.equal(backup.characterId,a.id);assert.equal(backup.records[0].text,'只属于 A 的记忆');
  const empty=await (await request(`characters/${b.id}/memories/export`)).json();assert.equal(empty.records.length,0);
  const txt=await request(`characters/${a.id}/memories/export?format=txt`);assert.match(txt.headers.get('content-type'),/text\/plain/);assert.match(await txt.text(),/只属于 A/);
  assert.equal((await request(`characters/${a.id}/memories/export?format=html`)).status,400);
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('记忆恢复：白名单、内容去重、重复恢复、已编辑及删除记录不复活',async()=>{
 const {mergeMemoryBackup,exportMemory}=await import('../src/memory.mjs');
 const backup={format:'muse-memory',schemaVersion:1,characterId:'phone',characterName:'来源',exportedAt:10,records:[{id:'one',text:'喜欢茶',importance:2,validUntil:1,apiKey:'SECRET'},{id:'two',text:'喜欢茶'},{id:'three',text:'喜欢书'}]};
 const old={id:'target',characterId:'target',records:[{id:'existing',text:'喜欢书'}]};
 const result=mergeMemoryBackup(old,backup,20);assert.equal(result.summary.added,1);assert.equal(result.summary.skipped,2);assert.equal(old.records.length,1);assert.ok(!JSON.stringify(result).includes('SECRET'));assert.equal(result.memory.records[1].validUntil,1);
 assert.equal(mergeMemoryBackup(result.memory,backup).summary.added,0);
 const edited=changeMemory(result.memory,'PUT',result.memory.records[1].id,{revision:1,text:'现在喜欢咖啡'});
 assert.equal(mergeMemoryBackup(edited,backup).summary.added,0);
 const deleted=changeMemory(edited,'DELETE',edited.records[1].id,{revision:2});assert.equal(mergeMemoryBackup(deleted,backup).summary.added,0);
 const sameRole=JSON.parse(exportMemory(result.memory,{id:'target',name:'目标'},'json'));
 assert.equal(mergeMemoryBackup(deleted,sameRole).summary.added,0);
 assert.throws(()=>mergeMemoryBackup(old,{...backup,records:[...backup.records,{id:'bad',text:''}]}));assert.equal(old.records.length,1);
 assert.throws(()=>mergeMemoryBackup(old,{...backup,schemaVersion:2}));
});

test('记忆恢复 API：预览不写入、合并与角色隔离、重启及重复导入',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-memory-restore-'));let server,base;
 async function start(){server=await createApp({dataDir:dir});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(r=>server.close(r));
 const request=(path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>(await request(...args)).json();
 await start();try{
  const a=await json('characters',{name:'A'}),b=await json('characters',{name:'B'});
  await json(`characters/${a.id}/memories`,{text:'原有记忆'});
  const backup={format:'muse-memory',schemaVersion:1,characterId:b.id,characterName:'B',exportedAt:1,records:[{id:'source',text:'待恢复记忆'}]};
  const path=`characters/${a.id}/memories`;
  assert.equal((await json(path+'/import',{backup,preview:true})).added,1);assert.equal((await json(path)).records.length,1);
  const result=await json(path+'/import',{backup,preview:false});assert.equal(result.memory.records.length,2);assert.equal(result.summary.added,1);
  assert.equal((await json(`characters/${b.id}/memories`)).records.length,0);
  const invalid={...backup,records:[...backup.records,{id:'invalid',text:'bad',validUntil:'bad'}]};
  assert.equal((await request(path+'/import',{backup:invalid,preview:false})).status,400);assert.equal((await json(path)).records.length,2);
  assert.equal((await request(path+'/import',{backup})).status,400);
  await stop();await start();assert.equal((await json(path+'/import',{backup,preview:false})).summary.added,0);assert.equal((await json(path)).records.length,2);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});

test('手机时间兼容：ISO 微秒、时区和毫秒时间戳可导出再恢复',async()=>{
 const {memoryTime,mergeMemoryBackup,exportMemory}=await import('../src/memory.mjs');
 const stamp=Date.parse('2026-10-17T15:11:36.827Z');
 assert.equal(memoryTime('2026-10-17T15:11:36.827712Z'),stamp);
 assert.equal(memoryTime('2026-10-17T23:11:36.827712+08:00'),stamp);
 assert.equal(memoryTime(stamp),stamp);assert.equal(memoryTime(null),null);
 for(const bad of ['bad','2026-02-30T00:00:00Z','2026-10-17T15:11:36',true,-1])assert.throws(()=>memoryTime(bad));
 const role={id:'phone',name:'测试'},memory={records:[{id:'one',text:'合成记忆',createdAt:'2026-10-17T15:11:36.827712Z',validUntil:'2026-12-01T00:00:00Z'}]};
 const oldBackup={format:'muse-memory',schemaVersion:1,characterId:role.id,characterName:role.name,exportedAt:stamp,records:memory.records};
 const target={id:'target',characterId:'target',records:[]};
 assert.equal(mergeMemoryBackup(target,oldBackup).memory.records[0].createdAt,stamp);
 const exported=JSON.parse(exportMemory(memory,role,'json'));assert.equal(exported.records[0].createdAt,stamp);
 assert.equal(mergeMemoryBackup(target,exported).summary.added,1);
});
