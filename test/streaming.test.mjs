// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { complete } from '../src/provider.mjs';
import { character } from '../src/characters.mjs';
import { createApp } from '../src/server.mjs';
const frame=(content,finish=null)=>`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:finish}]})}\r\n\r\n`;
test('SSE: 中文按字节分片、心跳、结束标记和长度上限',async()=>{
 const bytes=new TextEncoder().encode(': heartbeat\r\n\r\n'+frame('你好，')+frame('世界🌏','length')+'data: [DONE]\r\n\r\n');
 let index=0,output='',request;
 const result=await complete(character({name:'A'}),[],'test',{onDelta:d=>output+=d,fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return new Response(new ReadableStream({pull(c){if(index<bytes.length)c.enqueue(bytes.slice(index,index+=1));else c.close();}}));}});
 assert.equal(request.stream,true);assert.equal(output,'你好，世界🌏');assert.equal(result.content,output);assert.equal(result.finishReason,'length');
});
test('SSE: 提前断流、无效 JSON 和空输出不得伪装成功',async()=>{
 for(const [data,pattern]of [[frame('半截'),/提前结束/],['data: nope\n\n',/格式无效/],[frame('','stop')+'data: [DONE]\n\n',/有效文本/]]){
  await assert.rejects(complete(character({name:'A'}),[],'test',{onDelta:()=>{},fetchImpl:async()=>new Response(data)}),pattern);
 }
});
test('HTTP 流式：停止保存部分回复、无首字停止后重试、并发隔离、断线取消',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-stream-'));
 let mode='partial', calls=0;
 const provider=async(_r,_h,_key,{signal,onDelta})=>{
  calls++;
  if(mode==='success'){onDelta('完整回复');return {content:'完整回复',finishReason:'stop'};}
  if(mode==='partial')onDelta('已经生成的文字');
  if(mode==='failure'){onDelta('网络中断前的内容');throw new Error('模拟断流');}
  await new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 };
 const server=await createApp({dataDir:root,provider});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}/api/`;
 const req=(path,method='GET',body)=>fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(path,method,body)=>(await req(path,method,body)).json();
 async function stream(id,body={content:'你好'}) {
  const res=await req(`chats/${id}/messages`,'POST',{stream:true,...body});assert.equal(res.status,200);
  const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
  async function next(){while(!buffer.includes('\n')){const r=await reader.read();if(r.done)return null;buffer+=decoder.decode(r.value,{stream:true});}const n=buffer.indexOf('\n'),line=buffer.slice(0,n);buffer=buffer.slice(n+1);return JSON.parse(line);}
  return {next,reader};
 }
 try{
  await json('settings','PUT',{apiKey:'fake-test-key'});
  const role=await json('characters','POST',{name:'流式测试'});
  const chat=await json('chats','POST',{characterId:role.id});
  const first=await stream(chat.id);assert.equal((await first.next()).type,'start');assert.equal((await first.next()).content,'已经生成的文字');
  assert.equal((await json(`chats/${chat.id}`)).generating,true);
  assert.equal((await req(`chats/${chat.id}/messages`,'POST',{content:'重复'})).status,409);
  assert.equal((await req(`chats/${chat.id}`,'DELETE')).status,409);
  await json(`chats/${chat.id}/stop`,'POST',{});const stopped=await first.next();assert.equal(stopped.type,'error');assert.equal(stopped.chat.messages.at(-1).finishReason,'cancelled');assert.equal(stopped.chat.messages.at(-1).content,'已经生成的文字');
  assert.equal((await json(`chats/${chat.id}`)).generating,false);
  mode='success';const second=await stream(chat.id);await second.next();assert.equal((await second.next()).type,'delta');assert.equal((await second.next()).type,'done');
  mode='empty';const empty=await stream(chat.id);await empty.next();await json(`chats/${chat.id}/stop`,'POST',{});assert.equal((await empty.next()).chat.messages.at(-1).role,'user');
  mode='success';const retry=await stream(chat.id,{retry:true});await retry.next();await retry.next();const done=await retry.next();assert.equal(done.chat.messages.filter(m=>m.role==='user').length,3);
  mode='failure';const failure=await stream(chat.id);await failure.next();await failure.next();assert.equal((await failure.next()).chat.messages.at(-1).finishReason,'error');
  mode='partial';const disconnect=await stream(chat.id);await disconnect.next();await disconnect.next();await disconnect.reader.cancel();
  for(let n=0;n<40;n++){const current=await json(`chats/${chat.id}`);if(!current.generating){assert.equal(current.messages.at(-1).finishReason,'cancelled');break;}await new Promise(r=>setTimeout(r,10));if(n===39)assert.fail('断线未取消');}
  assert.equal(calls,6);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
