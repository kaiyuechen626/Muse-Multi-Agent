// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {createApp} from '../src/server.mjs';
import {Store} from '../src/store.mjs';
import {character} from '../src/characters.mjs';
import {LanSync} from '../src/lan-sync.mjs';
import {TaskIsolation} from '../src/task-isolation.mjs';

const until=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('condition timed out');};
const close=server=>new Promise(r=>server.close(r));

test('same role: QQ, web, DSH run concurrently with scoped contexts and stop',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-task-')),calls=[],sent=[];let server;
 const bridge=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  const data=req.url==='/get_login_info'?{user_id:'123456789'}:req.url==='/send_private_msg'?(sent.push(JSON.parse(raw)),{message_id:sent.length}):{messages:[]};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));
 });bridge.listen(0,'127.0.0.1');await once(bridge,'listening');
 const provider=async(role,history,key,{signal})=>new Promise((resolve,reject)=>{
  const call={role:structuredClone(role),history:structuredClone(history),signal,finish:()=>resolve({content:'reply-'+(history.at(-1)?.content||'QQ'),finishReason:'stop'})};
  calls.push(call);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 });
 try{
  server=await createApp({dataDir:root,provider,memoryExtractor:null});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/`;
  const request=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const api=async(...args)=>{const r=await request(...args);assert.ok(r.status<300,JSON.stringify(r));return r.data;};
  await api('settings','PUT',{apiKey:'fake'});const role=await api('characters','POST',{name:'same-role',persona:'shared-persona'});
  await api(`characters/${role.id}/memories`,'POST',{text:'shared-stable-preference'});
  await api('dsh/native/bind','POST',{sessionId:'native',roleId:role.id});
  await api('dsh/native/sync','POST',{sessionId:'native',roleId:role.id,throughSeq:1,messages:[{seq:1,role:'user',content:'DSH_PRIVATE_TASK banana',createdAt:1}]});
  const a=await api('chats','POST',{characterId:role.id}),b=await api('chats','POST',{characterId:role.id});
  await api('qq','PUT',{enabled:true,roleId:role.id,selfId:'123456789',peerId:'987654321',apiUrl:`http://127.0.0.1:${bridge.address().port}`,recoverOffline:false,proactive:true,quietStart:0,quietEnd:0});
  const pendingA=request(`chats/${a.id}/messages`,'POST',{content:'WEB_A_PRIVATE banana'});await until(()=>calls.length===1);
  const pendingQQ=request('qq/nudge','POST',{});await until(()=>calls.length===2);
  const pendingB=request(`chats/${b.id}/messages`,'POST',{content:'WEB_B_PRIVATE banana'});await until(()=>calls.length===3);
  // These writes used to be rejected by a global QQ lock.
  const native=await api('dsh/native/context','POST',{sessionId:'native',roleId:role.id,query:'banana'});
  assert.match(native.persona,/shared-persona/);assert.match(native.memory,/shared-stable-preference/);assert.doesNotMatch(native.memory,/WEB_[AB]_PRIVATE/);
  await api('dsh/native/sync','POST',{sessionId:'native',roleId:role.id,throughSeq:2,messages:[{seq:2,role:'assistant',content:'DSH own reply',createdAt:2}]});
  const tasks=(await api('tasks')).tasks;assert.equal(tasks.length,3);assert.deepEqual(new Set(tasks.map(t=>t.entry)),new Set(['web','qq']));
  for(const call of calls){assert.match(call.role.persona,/shared-persona/);assert.match(call.role.memoryContext,/shared-stable-preference/);assert.doesNotMatch(call.role.memoryContext,/DSH_PRIVATE_TASK|WEB_[AB]_PRIVATE/);assert.ok(call.history.filter(m=>m.role==='user').length<=1);}
  assert.equal((await request(`chats/${a.id}/messages`,'POST',{content:'duplicate'})).status,409);
  assert.equal((await request(`chats/${a.id}/stop`,'POST',{taskId:randomUUID()})).status,409);assert.equal(calls[0].signal.aborted,false);
  const taskA=tasks.find(t=>t.chatId===a.id);await api(`chats/${a.id}/stop`,'POST',{taskId:taskA.id});assert.equal((await pendingA).status,502);
  assert.equal(calls[1].signal.aborted,false);assert.equal(calls[2].signal.aborted,false);
  calls[1].finish();calls[2].finish();assert.equal((await pendingQQ).status,200);assert.equal((await pendingB).status,200);
  assert.equal(sent.length,1);assert.equal(sent[0].user_id,'987654321');assert.equal(sent[0].message[0].data.text,'reply-QQ');
  assert.equal((await api(`chats/${b.id}`)).messages.at(-1).content,'reply-WEB_B_PRIVATE banana');
  const qq=await api('qq');assert.equal((await request(`chats/${qq.chatId}/messages`,'POST',{content:'wrong entrance'})).status,409);
  const nativeState=await api('dsh/native/state','POST',{sessionId:'native'});assert.equal((await request(`chats/${nativeState.binding.chatId}/messages`,'POST',{content:'wrong entrance'})).status,409);
  assert.equal((await api('tasks')).tasks.length,0);
 }finally{for(const c of calls)c.finish();if(server)await close(server);await close(bridge);await rm(root,{recursive:true,force:true,maxRetries:5});}
});

test('conversation reservation is atomic and stale cleanup cannot release a new task',()=>{
 const tasks=new TaskIsolation(),a=tasks.acquire('chat','web','messages');
 assert.throws(()=>tasks.acquire('chat','qq','messages'),{status:409});
 const b=tasks.acquire('other-chat','dsh','context');tasks.release(a);
 const next=tasks.acquire('chat','web','messages');tasks.release(a);assert.equal(tasks.get('chat'),next);assert.equal(tasks.get('other-chat'),b);
});

test('phone concurrent continuation becomes an idempotent branch; DSH routing survives phone changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-phone-task-')),store=new Store(root);await store.init();let sync=new LanSync({store,port:0,discoveryPort:0});await sync.init();
 const deviceId=randomUUID();sync.state.devices[deviceId]={name:'phone',key:randomBytes(32).toString('base64url')};
 const row=(role,content)=>({id:randomUUID(),role,content,createdAt:Date.now()});
 try{
  const role=character({name:'same-role'});await store.put('characters',role);
  const chat={id:randomUUID(),characterId:role.id,characterName:role.name,title:'shared',createdAt:1,updatedAt:1,messages:[row('user','base'),row('assistant','base reply')]};await store.put('chats',chat);
  const initial=await sync.exchange(deviceId,{cursor:0,changes:[]}),baseline=initial.rows.find(r=>r.kind==='chats');
  const desktop=structuredClone(chat);desktop.messages.push(row('user','WEB_TASK'),row('assistant','WEB_RESULT'));desktop.updatedAt=2;await store.put('chats',desktop);
  const phone=structuredClone(baseline.body);phone.messages.push(row('user','PHONE_TASK'),row('assistant','PHONE_RESULT'));phone.updatedAt=3;
  const change={kind:'chats',id:chat.id,opId:randomUUID(),baseRevision:baseline.revision,body:phone};
  const result=await sync.exchange(deviceId,{cursor:initial.cursor,changes:[change]}),forkId=result.acks[0].forkChatId;assert.ok(forkId);
  assert.doesNotMatch(JSON.stringify(await store.get('chats',chat.id)),/PHONE_TASK|PHONE_RESULT/);const fork=await store.get('chats',forkId);assert.equal(fork.parentChatId,chat.id);assert.equal(fork.entry,'phone');assert.doesNotMatch(JSON.stringify(fork),/WEB_TASK|WEB_RESULT/);
  assert.ok(fork.messages.every(m=>!phone.messages.some(old=>old.id===m.id)));
  const retry=await sync.exchange(deviceId,{cursor:initial.cursor,changes:[change]});assert.equal(retry.acks[0].forkChatId,forkId);assert.equal((await store.list('chats')).length,2);
  const native={...chat,id:randomUUID(),entry:'dsh',dshNative:{sessionId:'native-session',throughSeq:1,rememberedTurn:0}};native.messages[0].dshSource={seq:1,digest:'source'};await store.put('chats',native);
  await sync.snapshot();const nativeRow=sync.state.rows['chats:'+native.id];const renamed=structuredClone(nativeRow.body);renamed.title='phone rename';
  const saved=await sync.exchange(deviceId,{cursor:0,changes:[{kind:'chats',id:native.id,opId:randomUUID(),baseRevision:nativeRow.revision,body:renamed}]});
  const after=await store.get('chats',native.id);assert.deepEqual(after.dshNative,native.dshNative);assert.deepEqual(after.messages[0].dshSource,native.messages[0].dshSource);assert.equal(after.title,'phone rename');
  const receipt=saved.acks[0],continued=structuredClone(receipt.body);continued.messages.push(row('user','phone continuation'));
  const separated=await sync.exchange(deviceId,{cursor:0,changes:[{kind:'chats',id:native.id,opId:randomUUID(),baseRevision:receipt.revision,body:continued}]});assert.ok(separated.acks[0].forkChatId);assert.deepEqual((await store.get('chats',native.id)).dshNative,native.dshNative);
  await sync.save();sync=new LanSync({store,port:0,discoveryPort:0});await sync.init();const again=await sync.exchange(deviceId,{cursor:0,changes:[change]});assert.equal(again.acks[0].forkChatId,forkId);
 }finally{await sync.stop();await rm(root,{recursive:true,force:true,maxRetries:5});}
});
