// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import {createHmac} from 'node:crypto';
import {QQChannel,validateQQ,qqClock} from '../src/qq-channel.mjs';
import {createApp} from '../src/server.mjs';
import {cleanSyncRecord} from '../src/full-backup.mjs';
const config={enabled:true,selfId:'123456789',peerId:'987654321',roleId:'12345678-1234-1234-1234-123456789012',proactive:true,quietStart:0,quietEnd:0};
test('QQ configuration restricts transport, account and proactive settings',()=>{
 for(const change of [{apiUrl:'http://example.com:3000'},{apiUrl:'http://127.0.0.1:3000/a'},{apiUrl:'https://127.0.0.1:3000'},{peerId:config.selfId},{dailyLimit:0},{intervalMinutes:1},{enabled:'yes'},{timeZone:'invalid'}])assert.throws(()=>validateQQ({...config,...change}));
 const c=validateQQ({...config,quietStart:23,quietEnd:8});assert.equal(qqClock(c,Date.parse('2026-10-22T16:00:00Z')).quiet,true);assert.equal(qqClock(c,Date.parse('2026-10-22T04:00:00Z')).quiet,false);assert.equal(qqClock(c,Date.parse('2026-10-22T16:00:00Z')).day,'2026-10-23');
});
test('QQ send ambiguity is persisted without replay; credentials excluded from public config',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-qq-'));let sends=0,now=Date.parse('2026-10-22T04:00:00Z');
 const make=()=>new QQChannel({root,now:()=>now,canWork:()=>true,fetchImpl:async url=>{if(url.endsWith('get_login_info'))return Response.json({status:'ok',retcode:0,data:{user_id:config.selfId}});if(url.endsWith('get_friend_msg_history'))return Response.json({status:'ok',retcode:0,data:{messages:[]}});sends++;throw Error('token-private');},turn:async({send})=>send('你好','message')});
 let q=make();try{
  await q.init();await q.configure({...config,token:'private-token'});assert.equal(q.status().config.token,undefined);assert.equal(q.status().tokenConfigured,true);
  await assert.rejects(q.nudge(),/无法确认/);assert.equal(q.status().deliveries.at(-1).status,'unknown');assert.equal(sends,1);assert.ok(!q.status().error.includes('token-private'));
  q.close();q=make();await q.init();await q.drain();assert.equal(sends,1);assert.equal(q.status().deliveries.at(-1).status,'unknown');
  q.state.config.dailyLimit=1;await assert.rejects(q.nudge(),/上限/);
 }finally{q.close();await rm(root,{recursive:true,force:true});}
});
test('saved QQ binding remains visible when the bridge is offline or logged into the wrong account',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-qq-status-'));let mode='online';
 const q=new QQChannel({root,canWork:()=>true,turn:async()=>{},fetchImpl:async()=>{if(mode==='offline')throw Error('transport-secret');return Response.json({status:'ok',retcode:0,data:{user_id:mode==='online'?config.selfId:'111111111'}});}});
 try{await q.init();await q.configure(config);assert.equal((await q.bindingStatus(config.roleId)).connection.state,'online');mode='offline';const offline=await q.bindingStatus(config.roleId);assert.equal(offline.bound,true);assert.equal(offline.enabled,true);assert.equal(offline.connection.state,'offline');assert.match(offline.connection.error,/无法连接 QQ 桥接/);assert.ok(!offline.connection.error.includes('transport-secret'));mode='wrong';assert.equal((await q.bindingStatus(config.roleId)).connection.state,'wrong-account');}finally{q.close();await rm(root,{recursive:true,force:true});}
});
test('role QQ binding checks real login/friend, prevents stale or implicit role takeover, and persists without leaking credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-qq-bind-'));let login=config.selfId,friends=[{user_id:config.peerId}],calls=[];
 const make=()=>new QQChannel({root,canWork:()=>true,turn:async()=>{},fetchImpl:async url=>{calls.push(url);return Response.json({status:'ok',retcode:0,data:url.endsWith('get_login_info')?{user_id:login}:friends});}});
 let q=make();const other='98765432-1234-1234-1234-123456789012';
 try{
  await q.init();await q.configure({...config,token:'local-only-token'});
  const expected={expectedRoleId:config.roleId,expectedSelfId:config.selfId,selfId:config.selfId,peerId:config.peerId};
  await assert.rejects(q.bindRole(other,expected),/确认切换/);assert.equal(q.state.config.roleId,config.roleId);
  login='111111111';await assert.rejects(q.bindRole(config.roleId,expected),/没有登录/);assert.equal(q.state.config.selfId,config.selfId);
  login=config.selfId;friends=[];await assert.rejects(q.bindRole(config.roleId,expected),/好友列表/);
  friends=[{user_id:config.peerId}];q.state.chatId='existing-chat';
  const own=await q.bindRole(config.roleId,expected);assert.equal(own.enabled,true);assert.equal(q.state.chatId,'existing-chat');assert.equal(own.token,undefined);assert.equal(own.webhookSecret,undefined);
  q.state.jobs=[{status:'queued'}];await assert.rejects(q.bindRole(other,{...expected,replace:true}),/待处理消息/);q.state.jobs=[];
  const changed=await q.bindRole(other,{...expected,replace:true});assert.equal(changed.bound,true);assert.equal(q.state.config.proactive,false);assert.equal(q.state.chatId,undefined);
  await assert.rejects(q.bindRole(config.roleId,expected),/已变化/);
  q.close();q=make();await q.init();assert.equal(q.binding(other).bound,true);assert.equal(q.binding(config.roleId).bound,false);
  await q.bindRole(other,{selfId:'',expectedRoleId:other,expectedSelfId:config.selfId});assert.equal(q.state.config.enabled,false);assert.equal(q.binding(other).bound,false);
  assert.ok(calls.every(url=>!url.endsWith('send_private_msg')));
 }finally{q.close();await rm(root,{recursive:true,force:true});}
});
test('QQ integration: signed friend events, deduplication, shared memory, persistence and proactive sending',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-qq-http-'));let server,base,sends=[],captured=[],extractions=0;
 const bridge=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;assert.equal(req.headers.authorization,'Bearer example-token');res.setHeader('Content-Type','application/json');if(req.url==='/get_login_info')return res.end(JSON.stringify({status:'ok',retcode:0,data:{user_id:config.selfId}}));if(req.url==='/get_friend_list')return res.end(JSON.stringify({status:'ok',retcode:0,data:[{user_id:config.peerId}]}));if(req.url==='/get_friend_msg_history')return res.end(JSON.stringify({status:'ok',retcode:0,data:{messages:[]}}));assert.equal(req.url,'/send_private_msg');sends.push(JSON.parse(body));res.end(JSON.stringify({status:'ok',retcode:0,data:{message_id:sends.length}}));});
 bridge.listen(0,'127.0.0.1');await once(bridge,'listening');
 const provider=async(role,history)=>{captured.push({role,history});return {content:'记得你喜欢茶。',finishReason:'stop'};};
 const start=async()=>{server=await createApp({dataDir:root,provider,memoryExtractor:async()=>{extractions++;return [{text:'用户喜欢茶'}];}});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;};
 const api=async(path,method='GET',body)=>{const r=await fetch(base+'/api/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
 const until=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('QQ task timed out');};
 try{
  await start();await api('settings','PUT',{apiKey:'fake'});const role=await api('characters','POST',{name:'QQ 测试角色',persona:'温柔'});await api(`characters/${role.id}/memories`,'POST',{text:'用户喜欢无糖茶'});
  let state=await api('qq','PUT',{...config,roleId:role.id,token:'example-token',apiUrl:`http://127.0.0.1:${bridge.address().port}`});await api('qq/test','POST',{});assert.equal(sends.length,0);
  const binding=await api(`characters/${role.id}/qq-binding`);assert.equal(binding.selfId,config.selfId);assert.equal(binding.token,undefined);
  const bound=await api(`characters/${role.id}/qq-binding`,'PUT',{selfId:config.selfId,peerId:config.peerId,expectedRoleId:binding.currentRoleId,expectedSelfId:binding.currentSelfId});assert.equal(bound.enabled,true);assert.equal(sends.length,0);
  const post=async(event,{signed=true}={})=>{const raw=JSON.stringify(event);return fetch(base+'/api/qq/events',{method:'POST',headers:{'Content-Type':'application/json',...(signed?{'X-Signature':'sha1='+createHmac('sha1',state.webhookSecret).update(raw).digest('hex')}:{})},body:raw});};
  const event={post_type:'message',message_type:'private',sub_type:'friend',time:Math.floor(Date.now()/1000),self_id:config.selfId,user_id:config.peerId,message_id:1,message:[{type:'text',data:{text:'我喜欢茶'}}]};
  assert.equal((await post(event,{signed:false})).status,403);
  assert.equal((await (await post({...event,user_id:'111111111'})).json()).ignored,true);
  assert.equal((await (await post({...event,message_type:'group'})).json()).ignored,true);
  assert.equal((await (await post({...event,message:[{type:'image',data:{url:'invalid'}}]})).json()).ignored,true);
  assert.equal((await (await post(event)).json()).accepted,true);assert.equal((await (await post(event)).json()).duplicate,true);
  await until(async()=>{state=await api('qq');return state.deliveries.at(-1)?.status==='sent'&&!state.working;});
  assert.equal(sends.length,1);assert.equal(sends[0].user_id,config.peerId);assert.equal(sends[0].message[0].type,'text');assert.match(captured[0].role.memoryContext,/无糖茶/);assert.match(captured[0].role.persona,/温柔/);
  const activity=await api('qq/activity');assert.equal(activity.chatId,state.chatId);assert.ok(activity.revision>0);assert.equal(activity.token,undefined);assert.equal(activity.webhookSecret,undefined);
  let chat=await api('chats/'+state.chatId);assert.deepEqual(chat.messages.map(m=>m.role),['user','assistant']);assert.equal(cleanSyncRecord('chats',chat).messages.length,2);
  await until(async()=>{const memory=await api(`characters/${role.id}/memories`);return memory.records.length===2&&memory.automatic.status!=='running';});assert.equal(extractions,1);
  await api('qq/nudge','POST',{});state=await api('qq');chat=await api('chats/'+state.chatId);assert.equal(sends.length,2);assert.equal(chat.messages.filter(m=>m.role==='user').length,1);assert.equal(extractions,1);assert.match(captured.at(-1).role.systemPrompt,/主动开启/);
  const backup=await api('backup');assert.ok(!JSON.stringify(backup).includes('example-token'));assert.equal(backup.chats[0].messages.length,3);
  await new Promise(r=>server.close(r));await start();state=await api('qq');assert.equal(state.config.enabled,true);assert.equal(state.chatId,chat.id);assert.equal((await (await post(event)).json()).duplicate,true);assert.equal(sends.length,2);
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await new Promise(r=>bridge.close(r));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
