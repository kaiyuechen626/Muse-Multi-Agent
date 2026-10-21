// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {extractMemory,appendAutomaticMemory} from '../src/automatic-memory.mjs';
import {createApp} from '../src/server.mjs';

test('自动记忆：独立提示词、用户原文依据、低置信度及敏感字段过滤',async()=>{
 const history=[{role:'user',content:'我喜欢无糖茶。我的密码是 123456。'},{role:'assistant',content:'你爱咖啡'}];let captured;
 const provider=async(role,messages)=>{captured={role,messages};return {finishReason:'stop',content:JSON.stringify({memories:[{text:'用户喜欢无糖茶。',evidence:'我喜欢无糖茶',confidence:0.98},{text:'用户喜欢咖啡',evidence:'你爱咖啡',confidence:0.99},{text:'用户密码是 123456',evidence:'我的密码是 123456',confidence:0.99}]})};};
 const facts=await extractMemory(history,{records:[]},'fake',{provider});assert.deepEqual(facts,[{text:'用户喜欢无糖茶。'}]);assert.equal(captured.role.model,'deepseek-chat');assert.match(captured.role.systemPrompt,/不扮演聊天角色/);
 await assert.rejects(extractMemory(history,null,'fake',{provider:async()=>({finishReason:'length',content:'{}'})}));
 await assert.rejects(extractMemory(history,null,'fake',{provider:async()=>({finishReason:'stop',content:'invalid'})}));
 const next=appendAutomaticMemory({records:[{id:'old',text:'用户喜欢无糖茶',deletedAt:1}]},facts,{chatId:'c',messageId:'m'});assert.equal(next.added,0);
 const added=appendAutomaticMemory({records:[]},facts,{chatId:'c',messageId:'m'});assert.equal(added.memory.records[0].source,'automatic');assert.equal(added.memory.records[0].sourceMessageId,'m');
});

test('自动记忆 HTTP：后台不阻塞回复、持久化开关、角色隔离、人工编辑不丢失和异常不影响聊天',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-auto-memory-'));let server,base,resolveExtraction,fail=false,calls=0;
 const memoryExtractor=async()=>{calls++;if(fail)throw Error('secret');return new Promise(resolve=>{resolveExtraction=resolve;});};
 async function start(){server=await createApp({dataDir:dir,provider:async()=>({content:'收到',finishReason:'stop'}),memoryExtractor});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(r=>server.close(r));
 const api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await (r.ok?Promise.resolve(''):r.text()));return r.json();};
 async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('后台任务没有完成');}
 await start();try{
  await api('settings','PUT',{apiKey:'fake'});
  const a=await api('characters','POST',{name:'A'}),b=await api('characters','POST',{name:'B'}),chat=await api('chats','POST',{characterId:a.id});const path=`characters/${a.id}/memories`;
  const reply=await api(`chats/${chat.id}/messages`,'POST',{content:'我喜欢茶'});assert.equal(reply.messages.at(-1).content,'收到');
  await until(()=>resolveExtraction);await api(path,'POST',{text:'人工新增'});resolveExtraction([{text:'用户喜欢茶'}]);
  await until(async()=>(await api(path)).automatic.status==='done');let memory=await api(path);assert.equal(memory.records.length,2);assert.equal(memory.automatic.added,1);assert.equal((await api(`characters/${b.id}/memories`)).records.length,0);
  resolveExtraction=null;await api(`chats/${chat.id}/messages`,'POST',{content:'我喜欢读书'});await until(()=>resolveExtraction);
  await api(path+'/automatic','PUT',{enabled:false});resolveExtraction([{text:'不应该保存'}]);await until(async()=>(await api(path)).automatic.status!=='running');assert.equal((await api(path)).records.length,2);
  await stop();await start();assert.equal((await api(path)).automatic.enabled,false);await api('settings','PUT',{apiKey:'fake'});
  await api(`chats/${chat.id}/messages`,'POST',{content:'保持关闭'});assert.equal(calls,2);
  await api(path+'/automatic','PUT',{enabled:true});fail=true;const ok=await api(`chats/${chat.id}/messages`,'POST',{content:'测试失败'});assert.equal(ok.messages.at(-1).content,'收到');
  await until(async()=>(await api(path)).automatic.status==='error');memory=await api(path);assert.equal(memory.records.length,2);assert.ok(!memory.automatic.error.includes('secret'));
 }finally{resolveExtraction?.([]);await stop();await rm(dir,{recursive:true,force:true});}
});
