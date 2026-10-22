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
  const result=await sync.exchange(deviceId,{cursor:initial.cursor,changes:[change]});assert.equal(result.acks[0].body.messages.length,3);assert.equal(result.acks[0].conflictId,null);
  const retry=await sync.exchange(deviceId,{cursor:initial.cursor,changes:[change]});assert.deepEqual(retry.acks,result.acks);
  const base=result.acks[0],pc=await store.get('chats',c.id);pc.title='电脑改名';await store.put('chats',pc);const phone=structuredClone(base.body);phone.title='手机改名';
  const conflict=await sync.exchange(deviceId,{cursor:0,changes:[{kind:'chats',id:c.id,opId:randomUUID(),baseRevision:base.revision,body:phone}]});assert.ok(conflict.acks[0].conflictId);assert.equal(sync.state.conflicts[0].incoming.title,'手机改名');assert.equal((await store.get('chats',c.id)).title,'电脑改名');
  const current=sync.state.rows['chats:'+c.id];await sync.exchange(deviceId,{cursor:0,changes:[{kind:'chats',id:c.id,opId:randomUUID(),baseRevision:current.revision,body:null}]});assert.equal(await store.get('chats',c.id),null);
  allowed=false;assert.equal((await sync.exchange(deviceId,{cursor:0,changes:[]})).busy,true);
 }finally{await sync.stop();await rm(dir,{recursive:true,force:true});}
 assert.deepEqual(mergeThree({a:1,b:1},{a:2,b:1},{a:1,b:2}),{a:2,b:2});assert.throws(()=>mergeThree({a:1},{a:2},{a:3}));assert.equal(digest({b:2,a:1}),digest({a:1,b:2}));
});
