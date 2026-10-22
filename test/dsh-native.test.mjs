// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
import {nativeChatId} from '../src/dsh-native.mjs';
import {transcript,installNativeChat} from '../plugin/native-chat.mjs';

test('DSH 原生会话：绑定持久化、角色隔离、记忆检索、幂等回写与自动记忆',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-native-'));let server,base,extractions=0;
 const start=async()=>{server=await createApp({dataDir:root,memoryExtractor:async()=>{extractions++;return [];}});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;};
 const request=async(path,body,method='POST')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
 const call=(action,body)=>request('/api/dsh/native/'+action,body);
 try{
  await start();
  const a=(await request('/api/characters',{name:'桃子',persona:'叫用户小月，温柔说话'})).data;
  const b=(await request('/api/characters',{name:'其他角色',persona:'PRIVATE_OTHER_PERSONA'})).data;
  const roleId=a.id,sessionId='dsh-session-a';
  assert.equal((await call('state',{sessionId})).data.binding,null);
  assert.equal((await call('bind',{sessionId,roleId})).status,200);
  assert.equal((await call('bind',{sessionId,roleId:b.id})).status,400);
  const messages=[{seq:3,role:'user',content:'我们去年一起看桃花',createdAt:1234},{seq:6,role:'assistant',content:'小月，记得那片桃花。',createdAt:1235,finishReason:'stop'}];
  const payload={sessionId,roleId,messages,throughSeq:7,completedTurn:1};
  assert.equal((await call('sync',payload)).status,200);
  assert.equal((await call('sync',payload)).status,200);
  assert.equal((await call('sync',{...payload,roleId:b.id})).status,400);
  assert.equal((await call('sync',{...payload,messages:[{...messages[0],content:'overwrite'}]})).status,400);
  const chat=(await request('/api/chats/'+nativeChatId(sessionId),{},'GET')).data;
  assert.equal(chat.messages.length,2);assert.equal(chat.characterId,a.id);
  assert.equal(extractions,1);
  await call('bind',{sessionId:'dsh-other',roleId:b.id});
  await call('sync',{sessionId:'dsh-other',roleId:b.id,messages:[{seq:1,role:'user',content:'PRIVATE_OTHER_SECRET',createdAt:1236}],throughSeq:1});
  await call('bind',{sessionId:'dsh-past',roleId});
  await call('sync',{sessionId:'dsh-past',roleId,messages:[{seq:1,role:'user',content:'以前在公园看桃花，约好明年再去',createdAt:1200}],throughSeq:1});
  const context=(await call('context',{sessionId,roleId,query:'桃花'})).data;
  assert.match(context.persona,/小月/);assert.doesNotMatch(JSON.stringify(context),/PRIVATE_OTHER/);
  assert.doesNotMatch(context.memory,/以前在公园看桃花/); // Other sessions remain searchable, not implicit task context.
  await request(`/api/characters/${roleId}/memories`,{text:'用户喜欢桃花'});
  assert.match((await call('context',{sessionId,roleId,query:'桃花'})).data.memory,/用户喜欢桃花/);
  await new Promise(r=>server.close(r));await start();
  assert.equal((await call('state',{sessionId})).data.binding.roleId,roleId);
  assert.equal((await call('sync',payload)).status,200);assert.equal(extractions,1);
  assert.equal((await call('context',{sessionId,roleId:b.id,query:'秘密'})).status,400);
  await request('/api/chats/'+chat.id,{},'DELETE');
  assert.equal((await call('context',{sessionId,roleId,query:'hello'})).status,400);
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('DSH 导出排除系统、工具、推理与后台提示；取消、长度终止保留状态',()=>{
 const user={type:'user/message',seq:1,time:100,data:{source:{kind:'user'},content:[{type:'text',text:'你好'}]}};
 const assistant={type:'assistant/message',seq:3,time:102,data:{message:{content:[{type:'reasoning',text:'secret'},{type:'text',text:'小月你好'}]},stream:[{type:'chunk',chunk:{type:'finish',reason:{kind:'max-tokens'}}}]}};
 const rows=transcript([user,{...user,seq:2,data:{...user.data,source:{kind:'context'}}},assistant,{type:'tool/result',seq:4,time:104,data:{}},{...assistant,seq:5,data:{...assistant.data,interrupted:true}}]);
 assert.equal(rows.length,3);assert.equal(rows[1].finishReason,'length');assert.equal(rows[2].finishReason,'cancelled');assert.doesNotMatch(JSON.stringify(rows),/secret/);
});

test('原生插件只处理确切绑定会话；加载失败禁止无记忆回答，回写失败可重试',async()=>{
 const listeners=new Map(),dispose=[],writes=[];let unavailable=false,failWrite=false;
 const ctx={on:(event,fn)=>listeners.set(event,fn),effect:fn=>dispose.push(fn()),webServer:{register:()=>()=>{}},agents:{get:()=>null},sessionQuery:{readSession:async id=>({events:[...(id==='bound'?[{seq:0,type:'muse/native-bound',data:{sessionId:id,roleId:'role-a'}}]:[]),{seq:1,type:'turn/end',data:{turn:1,reason:{kind:'completed'}},time:123}]})}};
 const request=async(url,init)=>{
  const action=url.split('/').at(-1),body=JSON.parse(init.body);
  if(unavailable)throw Error('offline');
  if(action==='state')return {ok:true,json:async()=>({binding:body.sessionId==='bound'?{roleId:'role-a',throughSeq:-1}:null})};
  if(action==='sync'){if(failWrite)throw Error('write offline');writes.push(body);return {ok:true,json:async()=>({ok:true})};}
  return {ok:true,json:async()=>({persona:'PERSONA_A',memory:'MEMORY_A'})};
 };
 const bridge=installNativeChat(ctx,{request});
 const base={sections:[{name:'deployment:persona-prefix',text:'coding persona'},{name:'tool-policy',text:'approval required'}],contexts:[{name:'sandbox',text:'sandbox'}],tools:['tool']};
 const assemble=id=>listeners.get('system-prompt/assemble')(base,{agent:{id}},async()=>base);
 try{
  assert.equal(await assemble('other'),base);
  const result=await assemble('bound');assert.match(JSON.stringify(result),/PERSONA_A/);assert.doesNotMatch(JSON.stringify(result),/coding persona/);assert.deepEqual(result.tools,base.tools);assert.deepEqual(result.contexts,base.contexts);assert.match(JSON.stringify(result),/approval required/);
  unavailable=true;await assert.rejects(assemble('bound'),/offline/);unavailable=false;
  // A restored host starts with an unknown cursor and recovers the durable suffix.
  await bridge.sync('bound');assert.equal(writes.length,1);
 }finally{for(const stop of dispose)if(typeof stop==='function')stop();}
});
