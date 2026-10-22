// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
import {Store} from '../src/store.mjs';
import {LanSync} from '../src/lan-sync.mjs';
import {cleanSyncRecord,restoreFullBackup} from '../src/full-backup.mjs';

async function fixture(t,options={}){
  const root=await mkdtemp(join(tmpdir(),'muse-rooms-'));
  let server,base;
  const start=async()=>{server=await createApp({dataDir:root,...options});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;};
  await start();
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
  const raw=(path,method='GET',body)=>fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const api=async(path,method,body)=>{const r=await raw(path,method,body),data=await r.json();assert.ok(r.ok,`${r.status}: ${JSON.stringify(data)}`);return data;};
  await api('settings','PUT',{apiKey:'fake-test-key'});
  const a=await api('characters','POST',{name:'林间',persona:'沉稳的植物学家，仅属于林间的人设',greeting:'私人开场白不进入群聊'});
  const b=await api('characters','POST',{name:'星野',persona:'热情的天文学家，仅属于星野的人设'});
  const outsider=await api('characters','POST',{name:'局外人'});
  const create=()=>api('chats','POST',{characterIds:[a.id,b.id],title:'周末聊天室'});
  return {root,raw,api,a,b,outsider,create,restart:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await start();await api('settings','PUT',{apiKey:'fake-test-key'});}};
}

test('聊天室：独立人格和记忆、共享发言、指定角色、检索归属、备份和重启',async t=>{
  const calls=[];
  const f=await fixture(t,{provider:async(role,history,key,{onDelta})=>{calls.push({role,history});const content=role.name+'：周末可以去植物园。';onDelta?.(content);return {content,finishReason:'stop'};}});
  await f.api(`characters/${f.a.id}/memories`,'POST',{text:'林间私有记忆：蓝色温室钥匙。'});
  await f.api(`characters/${f.b.id}/memories`,'POST',{text:'星野私有记忆：红色望远镜编号。'});
  const single=await f.api('chats','POST',{characterId:f.a.id});
  await f.api(`chats/${single.id}/messages`,'POST',{content:'私人交谈紫色密语'});calls.length=0;
  let room=await f.create();assert.equal(room.kind,'group');assert.equal(room.messages.length,0);
  for(const characterIds of [[f.a.id],[f.a.id,f.a.id],[f.a.id,'bad'],Array(9).fill(f.a.id)])assert.equal((await f.raw('chats','POST',{characterIds})).status,400);
  const invalid=await f.raw(`chats/${room.id}/messages`,'POST',{content:'你好',replyCharacterId:f.outsider.id});assert.equal(invalid.status,400);
  room=await f.api(`chats/${room.id}/messages`,'POST',{content:'周末去哪里？'});
  assert.deepEqual(room.messages.map(m=>m.characterId),[undefined,f.a.id,f.b.id]);
  assert.equal(calls.length,2);assert.equal(calls[0].role.persona,f.a.persona);assert.equal(calls[1].role.persona,f.b.persona);
  assert.match(calls[0].role.memoryContext,/蓝色温室/);assert.doesNotMatch(JSON.stringify(calls[0]),/红色望远镜|仅属于星野的人设/);
  assert.match(calls[1].role.memoryContext,/红色望远镜/);assert.doesNotMatch(JSON.stringify(calls[1]),/蓝色温室|仅属于林间的人设|紫色密语/);
  const other=JSON.parse(calls[1].history.at(-1).content);assert.equal(other.speakerId,f.a.id);assert.equal(other.speaker,f.a.name);assert.equal(calls[1].history.at(-1).role,'user');
  assert.ok(room.messages[1].memoryTrace.records.some(r=>r.text.includes('蓝色温室')));
  assert.ok(room.messages[2].memoryTrace.records.some(r=>r.text.includes('红色望远镜')));
  room=await f.api(`chats/${room.id}/messages`,'POST',{content:'星野，你怎么看？',replyCharacterId:f.b.id});
  assert.equal(calls.length,3);assert.equal(room.messages.length,5);assert.equal(room.messages.at(-1).characterId,f.b.id);assert.equal(calls[2].history.find(m=>m.id===room.messages[2].id).role,'assistant');
  const memory=await f.api(`characters/${f.b.id}/memories`,'POST',{text:'用户计划周末游园',sourceChatId:room.id,sourceMessageId:room.messages[0].id});
  const record=memory.records.find(r=>r.sourceChatId===room.id),sources=await f.api(`characters/${f.b.id}/memories/${record.id}/sources`);assert.equal(sources.sources[0].chatId,room.id);
  assert.equal((await f.raw(`characters/${f.outsider.id}/memories`,'POST',{text:'越界',sourceChatId:room.id,sourceMessageId:room.messages[0].id})).status,400);
  const hits=await f.api(`characters/${f.b.id}/memory-search?q=${encodeURIComponent('植物园')}`);assert.ok(hits.results.some(h=>h.chatId===room.id));
  const outsiderHits=await f.api(`characters/${f.outsider.id}/memory-search?q=${encodeURIComponent('植物园')}`);assert.equal(outsiderHits.results.length,0);
  const json=await f.api(`chats/${room.id}/export`),md=await (await f.raw(`chats/${room.id}/export?format=md`)).text();assert.match(md,/## 林间/);assert.match(md,/## 星野/);assert.deepEqual(json.participants,room.participants);
  const imported=await f.api('chats/import','POST',{characterId:f.a.id,chat:json});assert.equal(imported.chat.kind,'group');assert.equal(imported.chat.messages[2].characterId,f.b.id);assert.notEqual(imported.chat.messages[0].id,room.messages[0].id);
  assert.equal((await f.api('chats/import','POST',{characterId:f.a.id,chat:json})).duplicate,true);
  const backup=await f.api('backup');assert.deepEqual(backup.chats.find(c=>c.id===room.id).participants,room.participants);assert.equal(backup.chats.find(c=>c.id===room.id).messages[2].characterId,f.b.id);
  const restoredStore=new Store(join(f.root,'restored'));await restoredStore.init();await restoreFullBackup(restoredStore,backup);assert.deepEqual((await restoredStore.get('chats',room.id)).participants,room.participants);assert.equal((await restoredStore.get('chats',room.id)).messages[2].characterId,f.b.id);
  const bArchive=await readFile(join(f.root,'memory-library',`${f.b.name}--${f.b.id}`,'对话记录',room.id+'.json'),'utf8');assert.doesNotMatch(bArchive,/蓝色温室|紫色密语/);assert.match(bArchive,/红色望远镜/);
  const broken=structuredClone(json);broken.messages[2].characterId=f.outsider.id;assert.throws(()=>cleanSyncRecord('chats',broken),/发言者/);
  const branch=await f.api(`chats/${room.id}/revision`,'POST',{updatedAt:room.updatedAt,messageId:room.messages[0].id,action:'edit',content:'周末去植物园吗？'});assert.equal(branch.kind,'group');assert.deepEqual(branch.participants,room.participants);
  const continued=await f.api(`chats/${branch.id}/messages`,'POST',{retry:true});assert.equal(continued.messages.length,3);assert.equal(continued.messages.at(-1).characterId,f.b.id);
  const sync=new LanSync({store:new Store(f.root)});await sync.init();await sync.snapshot();assert.equal(sync.state.rows['chats:'+room.id].body.kind,'group');assert.ok(sync.state.rows['chats:'+single.id]);await sync.stop();
  await f.restart();room=await f.api(`chats/${room.id}`);assert.equal(room.messages.at(-1).characterId,f.b.id);assert.equal(room.participants.length,2);
});

test('聊天室流式：中断保留身份、继续只补未完成角色、停止和并发锁',async t=>{
  let mode='fail',bId;const calls=[];
  const f=await fixture(t,{provider:async(role,history,key,{signal,onDelta})=>{
    calls.push(role.id);
    if(role.id===bId&&mode==='fail'){onDelta?.('未完成的半句');throw Error('测试断线');}
    if(mode==='wait'){onDelta?.('停止前的部分');await new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}
    onDelta?.(role.name+' 完整回复');return {content:role.name+' 完整回复',finishReason:'stop'};
  }});bId=f.b.id;
  let room=await f.create();
  const events=(await (await f.raw(`chats/${room.id}/messages`,'POST',{content:'你好',stream:true})).text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.filter(e=>e.type==='speaker').map(e=>e.characterId),[f.a.id,f.b.id]);assert.equal(events.at(-1).type,'error');room=events.at(-1).chat;
  assert.equal(room.messages.at(-1).characterId,f.b.id);assert.equal(room.messages.at(-1).finishReason,'error');assert.deepEqual(room.pendingTurn.completedIds,[f.a.id]);
  const full=await f.api('backup');assert.equal(full.chats.find(c=>c.id===room.id).pendingTurn.partialMessageId,room.messages.at(-1).id);
  await f.restart();mode='ok';room=await f.api(`chats/${room.id}/messages`,'POST',{retry:true});assert.deepEqual(calls,[f.a.id,f.b.id,f.b.id]);assert.equal(room.messages.length,3);assert.equal(room.pendingTurn,undefined);assert.equal(room.messages.at(-1).finishReason,'stop');
  mode='wait';const response=await f.raw(`chats/${room.id}/messages`,'POST',{content:'第二轮',stream:true});const reader=response.body.getReader(),decoder=new TextDecoder();let text='';while(!text.includes('停止前的部分'))text+=decoder.decode((await reader.read()).value);
  assert.equal((await f.raw(`chats/${room.id}/messages`,'POST',{content:'重复'})).status,409);
  assert.equal((await f.raw(`characters/${f.b.id}`,'DELETE',{updatedAt:f.b.updatedAt})).status,409);
  await f.api(`chats/${room.id}/stop`,'POST',{});while(true){const r=await reader.read();if(r.done)break;text+=decoder.decode(r.value);}reader.releaseLock();
  room=text.trim().split('\n').map(JSON.parse).at(-1).chat;assert.equal(room.messages.at(-1).finishReason,'cancelled');assert.equal(room.messages.at(-1).characterId,f.a.id);
  mode='ok';room=await f.api(`chats/${room.id}/messages`,'POST',{retry:true});assert.equal(room.messages.filter(m=>m.role==='user').length,2);assert.equal(room.messages.length,6);
  await f.api(`characters/${f.a.id}`,'DELETE',{updatedAt:f.a.updatedAt});assert.equal((await f.raw(`chats/${room.id}/messages`,'POST',{content:'全员'})).status,409);
  room=await f.api(`chats/${room.id}/messages`,'POST',{content:'仅剩下的角色',replyCharacterId:f.b.id});assert.equal(room.messages.at(-1).characterId,f.b.id);
});

test('聊天室自动记忆：分别写入原角色记忆库，其他 AI 仍标为 assistant',async t=>{
  const extracted=[];
  const f=await fixture(t,{provider:async()=>({content:'知道啦',finishReason:'stop'}),memoryExtractor:async(history,memory)=>{extracted.push({history,memory});return [{text:'用户喜欢无糖茶'}];}});
  let room=await f.create();room=await f.api(`chats/${room.id}/messages`,'POST',{content:'我喜欢无糖茶'});
  for(let n=0;n<100;n++){
    const a=await f.api(`characters/${f.a.id}/memories`),b=await f.api(`characters/${f.b.id}/memories`);
    if(a.records.length&&b.records.length&&a.automatic.status!=='running'&&b.automatic.status!=='running'){assert.equal(a.records[0].sourceChatId,room.id);assert.equal(b.records[0].sourceMessageId,room.messages[0].id);assert.notEqual(a.records[0].id,b.records[0].id);break;}
    if(n===99)assert.fail('自动记忆未落盘');await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(extracted.length,2);assert.ok(extracted.every(e=>e.history.filter(m=>m.role==='user').length===1));
  assert.equal((await f.api(`characters/${f.outsider.id}/memories`)).records.length,0);
});
