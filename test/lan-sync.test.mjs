// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {character} from '../src/characters.mjs';
import {LanSync,localAddress} from '../src/lan-sync.mjs';
import {seal,open,mergeThree,digest} from '../src/lan-sync-codec.mjs';
import {createGroupChat} from '../src/group-chat.mjs';

test('聊天室能力协商、升级补发、双端发言身份及旧手机防覆盖',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-room-sync-')),store=new Store(dir);await store.init();const sync=new LanSync({store,port:0,discoveryPort:0});await sync.init();
 try{
  const deviceId=randomUUID();sync.state.devices[deviceId]={name:'手机',key:randomBytes(32).toString('base64url')};
  const a=character({name:'林间'}),b=character({name:'星野'});await store.put('characters',a);await store.put('characters',b);
  const room=await createGroupChat({characterIds:[a.id,b.id]},id=>store.get('characters',id));await store.put('chats',room);
  const legacy=await sync.exchange(deviceId,{cursor:0,changes:[]});assert.ok(legacy.rows.every(r=>!r.groupChat));assert.equal(legacy.hasMore,false);assert.equal(legacy.cursor,sync.state.seq);
  const upgraded=await sync.exchange(deviceId,{cursor:legacy.cursor,changes:[],groupChatVersion:1});const baseline=upgraded.rows.find(r=>r.id===room.id);assert.ok(baseline);assert.equal(baseline.body.kind,'group');
  const phone=structuredClone(baseline.body);phone.messages.push({id:randomUUID(),role:'assistant',characterId:b.id,characterName:b.name,content:'手机里星野的发言',createdAt:Date.now()});phone.updatedAt++;
  const pc=structuredClone(room);pc.messages.push({id:randomUUID(),role:'assistant',characterId:a.id,characterName:a.name,content:'电脑里林间的发言',createdAt:Date.now()});pc.updatedAt++;await store.put('chats',pc);
  const change={kind:'chats',id:room.id,opId:randomUUID(),baseRevision:baseline.revision,body:phone};
  const merged=await sync.exchange(deviceId,{cursor:upgraded.cursor,changes:[change],groupChatVersion:1});assert.equal(merged.acks[0].conflictId,null);assert.deepEqual(new Set(merged.acks[0].body.messages.map(m=>m.characterId)),new Set([a.id,b.id]));
  const downgrade={...merged.acks[0].body};delete downgrade.kind;delete downgrade.participants;
  await assert.rejects(sync.exchange(deviceId,{cursor:0,changes:[{...change,opId:randomUUID(),body:downgrade}]}),/更新手机/);
  await assert.rejects(sync.exchange(deviceId,{cursor:0,groupChatVersion:1,changes:[{...change,opId:randomUUID(),body:downgrade}]}),/对话类型/);
  const row=sync.state.rows['chats:'+room.id];await sync.exchange(deviceId,{cursor:0,groupChatVersion:1,changes:[{...change,opId:randomUUID(),baseRevision:row.revision,body:null}]});
  const tombstone=sync.state.rows['chats:'+room.id];assert.equal(tombstone.groupChat,true);assert.equal(tombstone.body,null);
  const hidden=await sync.exchange(deviceId,{cursor:legacy.cursor,changes:[]});assert.ok(hidden.rows.every(r=>!r.groupChat));assert.equal(hidden.cursor,sync.state.seq);
 }finally{await sync.stop();await rm(dir,{recursive:true,force:true});}
});

test('手机同一聊天室的同名角色不会被合并为一个人',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-room-identity-')),store=new Store(dir);await store.init();const sync=new LanSync({store});await sync.init();
 try{const did=randomUUID();sync.state.devices[did]={name:'手机'};const a=character({name:'同名'}),b=character({name:'同名'});await store.put('characters',a);
  const result=await sync.exchange(did,{cursor:0,groupChatVersion:1,groupMemberships:[[a.id,b.id]],roleInventory:[{id:a.id,name:a.name},{id:b.id,name:b.name}],changes:[{kind:'characters',id:b.id,opId:randomUUID(),baseRevision:0,body:b}]});
  assert.deepEqual(result.nameMatches,[]);assert.ok(await store.get('characters',a.id));assert.ok(await store.get('characters',b.id));assert.equal(sync.identities.canonical(b.id),b.id);
 }finally{await sync.stop();await rm(dir,{recursive:true,force:true});}
});

test('局域网同步加密认证、上下文隔离、二维码一次性、重启配对和撤销',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-lan-')),store=new Store(dir);await store.init();let sync=new LanSync({store,port:0,discoveryPort:0});await sync.init();
 try{
  const expired=await sync.createPairing('usb'),old=JSON.parse(Buffer.from(expired.uri.split('/').at(-1),'base64url'));sync.pairing.expires=0;
  const stale=await fetch(`http://127.0.0.1:${sync.http.address().port}/pair`,{method:'POST',body:JSON.stringify({pairId:old.pairId,requestId:randomUUID()})});assert.equal(stale.status,403);
  const pairing=await sync.createPairing('usb'),p=JSON.parse(Buffer.from(pairing.uri.split('/').at(-1),'base64url'));
  const deviceId=randomUUID(),requestId=randomUUID();const request={pairId:p.pairId,requestId,payload:seal(p.key,`pair:request:${p.pairId}:${requestId}`,{deviceId,name:'测试手机'})};
  const post=(path,value)=>fetch(`http://127.0.0.1:${sync.http.address().port}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  const response=await post('/pair',request);assert.equal(response.status,200);const peer=open(p.key,`pair:response:${p.pairId}:${requestId}`,(await response.json()).payload);
  assert.equal((await post('/pair',request)).status,403);
  assert.equal(sync.status().devices.length,1);assert.equal(JSON.stringify(sync.status()).includes(peer.key),false);
  const rid=randomUUID(),payload={deviceId,requestId:rid,payload:seal(peer.key,`sync:request:${deviceId}:${rid}`,{cursor:0,changes:[]})};
  const first=await post('/exchange',payload);assert.equal(first.status,200);assert.equal(open(peer.key,`sync:response:${deviceId}:${rid}`,(await first.json()).payload).serverId,sync.state.id);
  const invalid=structuredClone(payload);invalid.payload.tag=randomBytes(16).toString('base64url');assert.equal((await post('/exchange',invalid)).status,400);
  assert.throws(()=>open(peer.key,`sync:response:${deviceId}:${rid}`,payload.payload));
  const savedId=sync.state.id;await sync.stop();sync=new LanSync({store,port:0,discoveryPort:0});await sync.init();assert.equal(sync.state.id,savedId);assert.equal(sync.state.devices[deviceId].key,peer.key);
  await sync.revoke(deviceId);assert.equal((await post('/exchange',payload)).status,403);
 }finally{await sync.stop();await rm(dir,{recursive:true,force:true});}
 assert.equal(localAddress('203.0.113.10'),false);assert.equal(localAddress('192.168.1.5'),true);
});

test('同步重试幂等、双端新消息合并、同字段冲突保留、删除传播和忙碌等待',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-merge-')),store=new Store(dir);await store.init();let allowed=true;const sync=new LanSync({store,port:0,discoveryPort:0,canSync:()=>allowed});await sync.init();
 try{
  const deviceId=randomUUID();sync.state.devices[deviceId]={name:'手机',key:randomBytes(32).toString('base64url')};const role=character({name:'角色',apiKey:'SHOULD_NOT_SYNC'});await store.put('characters',role);
  const c={id:randomUUID(),characterId:role.id,characterName:role.name,title:'聊天',createdAt:1,updatedAt:1,messages:[{id:randomUUID(),role:'user',content:'开头',createdAt:1}]};await store.put('chats',c);
  const initial=await sync.exchange(deviceId,{cursor:0,changes:[]});const baseline=initial.rows.find(r=>r.kind==='chats');assert.ok(baseline);assert.equal(JSON.stringify(initial).includes('SHOULD_NOT_SYNC'),false);
  const desktop=structuredClone(c);desktop.messages.push({id:randomUUID(),role:'assistant',content:'电脑新增',createdAt:2});desktop.updatedAt=2;await store.put('chats',desktop);
  const mobile=structuredClone(baseline.body);mobile.messages.push({id:randomUUID(),role:'user',content:'手机新增',createdAt:3});mobile.updatedAt=3;
  const change={kind:'chats',id:c.id,opId:randomUUID(),baseRevision:baseline.revision,body:mobile};
  const result=await sync.exchange(deviceId,{cursor:initial.cursor,changes:[change]});assert.equal(result.acks[0].body.messages.length,2);assert.equal(result.acks[0].conflictId,null);assert.ok(result.acks[0].forkChatId);assert.equal((await store.get('chats',result.acks[0].forkChatId)).messages.at(-1).content,'手机新增');
  const retry=await sync.exchange(deviceId,{cursor:initial.cursor,changes:[change]});assert.deepEqual(retry.acks,result.acks);
  const base=result.acks[0],pc=await store.get('chats',c.id);pc.title='电脑改名';await store.put('chats',pc);const phone=structuredClone(base.body);phone.title='手机改名';
  const conflict=await sync.exchange(deviceId,{cursor:0,changes:[{kind:'chats',id:c.id,opId:randomUUID(),baseRevision:base.revision,body:phone}]});assert.ok(conflict.acks[0].conflictId);assert.equal(sync.state.conflicts[0].incoming.title,'手机改名');assert.equal((await store.get('chats',c.id)).title,'电脑改名');
  const current=sync.state.rows['chats:'+c.id];await sync.exchange(deviceId,{cursor:0,changes:[{kind:'chats',id:c.id,opId:randomUUID(),baseRevision:current.revision,body:null}]});assert.equal(await store.get('chats',c.id),null);
  allowed=false;assert.equal((await sync.exchange(deviceId,{cursor:0,changes:[]})).busy,true);
 }finally{await sync.stop();await rm(dir,{recursive:true,force:true});}
 assert.deepEqual(mergeThree({a:1,b:1},{a:2,b:1},{a:1,b:2}),{a:2,b:2});assert.throws(()=>mergeThree({a:1},{a:2},{a:3}));assert.equal(digest({b:2,a:1}),digest({a:1,b:2}));
});
