// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {character} from '../src/characters.mjs';
import {MemoryLibrary,dayOf} from '../src/memory-library.mjs';
import {memoryContextSnapshot} from '../src/memory.mjs';
import {exportFullBackup} from '../src/full-backup.mjs';
import {expandQuery} from '../src/vector-index.mjs';
import {createApp} from '../src/server.mjs';
import {once} from 'node:events';
const time=Date.parse('2026-10-20T16:01:00Z');
async function setup(t,provider=null){const dir=await mkdtemp(join(tmpdir(),'muse-library-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new Store(join(dir,'data'));await store.init();const library=new MemoryLibrary({root:join(dir,'memory'),store,provider,getKey:()=> 'test',now:()=>Date.parse('2026-10-22T10:00:00Z')});await library.init();store.onChange=(...args)=>library.changed(...args);store.onChangeError=e=>{throw e;};return {dir,store,library};}
function chat(role,content='下个月想去京都旅行',reply='记下了，京都旅行。'){return {schemaVersion:1,id:randomUUID(),characterId:role.id,characterName:role.name,title:'旅行计划',createdAt:time,updatedAt:time,messages:[{id:randomUUID(),role:'user',content,createdAt:time},{id:randomUUID(),role:'assistant',content:reply,createdAt:time+1}]};}
test('未来角色建目录、迁移完整副本、持久化索引与来源、同名隔离、日期边界',async t=>{
 const {store,library}=await setup(t),a=character({name:'桃子',persona:'温和'}),b=character({name:'桃子'});await store.put('characters',a);await store.put('characters',b);const c=chat(a);await store.put('chats',c);await store.put('chats',chat(b,'火星秘密基地','秘密'));
 const dir=join(library.root,library.catalog.roles[a.id].folder);for(const name of ['对话记录','每日备份','向量索引','长期记忆.md','人格.md','记忆一览.md'])assert.ok((await readdir(dir)).includes(name));
 assert.equal(dayOf(time),'2026-10-21');assert.equal(dayOf(time-120000),'2026-10-20');
 assert.deepEqual(JSON.parse(await readFile(join(dir,'对话记录',c.id+'.json'),'utf8')),c);
 const hits=await library.search(a.id,'京都旅游');assert.ok(hits.some(h=>h.messageId===c.messages[0].id));assert.ok(hits[0].neighbors.length);assert.ok(!JSON.stringify(hits).includes('火星'));
 const index=JSON.parse(await readFile(join(dir,'向量索引','index.json'),'utf8'));assert.ok(index.documents[0].vector.length);assert.ok(!('text' in index.documents[0]));
 const folders=await readdir(library.root);await library.syncAll();assert.deepEqual(await readdir(library.root),folders);a.name='新名字';await store.put('characters',a);assert.equal(join(library.root,library.catalog.roles[a.id].folder),dir);
});
test('删除、过期、改归属、恢复和永久删除不会召回旧内容',async t=>{
 const {store,library}=await setup(t),a=character({name:'甲'}),b=character({name:'乙'});await store.put('characters',a);await store.put('characters',b);const c=chat(a);await store.put('chats',c);
 await store.put('memories',{id:a.id,characterId:a.id,records:[{id:randomUUID(),text:'京都旧计划',validUntil:1},{id:randomUUID(),text:'京都已删',deletedAt:1}]});
 c.deletedAt=time;await store.put('chats',c);assert.equal((await library.search(a.id,'京都')).length,0);delete c.deletedAt;await store.put('chats',c);assert.ok((await library.search(a.id,'京都')).length);
 c.characterId=b.id;await store.put('chats',c);assert.equal((await library.search(a.id,'京都')).length,0);assert.ok((await library.search(b.id,'京都')).length);
 await store.remove('chats',c.id);assert.equal((await library.search(b.id,'京都')).length,0);
 const second=chat(a);await store.put('chats',second);a.deletedAt=time;await store.put('characters',a);assert.equal((await library.search(a.id,'京都')).length,0);
});
test('命中后读取原文、跨聊天注入、当前轮排除、追踪备份与检索开关',async t=>{
 const {store,library}=await setup(t),role=character({name:'甲'});await store.put('characters',role);const c=chat(role);await store.put('chats',c);
 const history=[{id:randomUUID(),role:'user',content:'之前的京都旅行怎么安排？',createdAt:time+100}];const snapshot=await library.context(role,null,history,memoryContextSnapshot(null));assert.match(snapshot.prompt,/下个月想去京都旅行/);assert.equal(snapshot.trace.history[0].chatId,c.id);
 const currentOnly=await library.context(role,null,c.messages,memoryContextSnapshot(null));assert.equal(currentOnly.trace.history.length,0);
 const disabled=await library.context(role,{retrievalEnabled:false},history,memoryContextSnapshot(null));assert.equal(disabled.trace.history,undefined);
 const reply=chat(role,'京都','回答');reply.messages[1].memoryTrace=snapshot.trace;await store.put('chats',reply);const backup=await exportFullBackup(store);assert.deepEqual(backup.chats.find(r=>r.id===reply.id).messages[1].memoryTrace.history,JSON.parse(JSON.stringify(snapshot.trace.history)));
});
test('每日总结补跑与幂等、失败保留原文、聊天新增使旧总结失效',async t=>{
 let calls=0,fail=false;const {store,library}=await setup(t,async()=>{calls++;if(fail)throw Error('offline');return {content:'当天讨论京都旅行，尚未确定行程。',finishReason:'stop'};});const role=character({name:'甲'});await store.put('characters',role);const c=chat(role);await store.put('chats',c);
 assert.equal((await library.summarizePending()).completed,1);assert.equal((await library.summarizePending()).completed,0);assert.equal(calls,1);
 c.messages.push({id:randomUUID(),role:'user',content:'还没订车票',createdAt:time+2});await store.put('chats',c);const file=join(library.root,library.catalog.roles[role.id].folder,'每日备份','2026-10-21.json');assert.equal(JSON.parse(await readFile(file)).summary,null);
 fail=true;await library.summarizePending();assert.equal(JSON.parse(await readFile(file)).messages.length,3);fail=false;library.retry.clear();assert.equal((await library.summarizePending()).completed,1);
});
test('语义改写和故障回退',async()=>{const query='出行安排';assert.match(await expandQuery(query,[],'key',async()=>({finishReason:'stop',content:'{"keywords":["旅行","交通"]}'})),/旅行/);assert.equal(await expandQuery(query,[],'key',async()=>{throw Error('offline');}),query);});
test('HTTP 新任务隔离旧聊天原文，仍可手动检索和共享长期记忆',async t=>{
 const root=await mkdtemp(join(tmpdir(),'muse-library-http-'));let captured;
 const server=await createApp({dataDir:root,provider:async role=>{captured=role.memoryContext;return {content:'测试回答',finishReason:'stop'};}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api/`,api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r.json();};
 await api('settings','PUT',{apiKey:'test'});const role=await api('characters','POST',{name:'测试记忆角色'}),old=chat(role,'京都行程中要去岚山','岚山是这次行程的安排。');const imported=await api('chats/import','POST',{characterId:role.id,chat:old});
 const fresh=await api('chats','POST',{characterId:role.id});const reply=await api(`chats/${fresh.id}/messages`,'POST',{content:'京都行程还记得吗？'});assert.doesNotMatch(captured,/京都行程中要去岚山/);assert.ok(!reply.messages.at(-1).memoryTrace.history.some(h=>h.chatId===imported.chat.id));
 const search=await api(`characters/${role.id}/memory-search?q=${encodeURIComponent('岚山')}`);assert.ok(search.results.some(h=>h.chatId===imported.chat.id));const status=await api('memory-library');assert.equal(status.roles.length,1);
 await api(`characters/${role.id}/memories/retrieval`,'PUT',{enabled:false});await api(`chats/${fresh.id}/messages`,'POST',{content:'再聊一下岚山'});assert.ok(!captured.includes('历史依据'));
});
