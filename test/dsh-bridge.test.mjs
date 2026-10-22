// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {installBridge} from '../plugin/bridge.mjs';
import {DshConnection} from '../src/dsh-connection.mjs';
import {completeWithTools} from '../src/tool-completion.mjs';
test('配对一次性、角色授权隔离、正式调度、重复调用拒绝、撤销',async()=>{
 let handler,count=0;const agent={id:'agent',session:{meta:{title:'模拟会话'}},runMaintenance:job=>job(new AbortController().signal)};
 const server=http.createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 const ctx={effect:fn=>fn(),webServer:{port:server.address().port,register:r=>{handler=r.handler;return()=>{};}},agents:{list:()=>[agent],get:id=>id==='agent'?agent:null},tools:{schemas:()=>[{name:'read',description:'只读测试',parameters:{type:'object',properties:{}}}],execute:async input=>{assert.equal(input.agent,agent);assert.equal(input.parent,undefined);count++;return {status:'success',content:[{type:'text',text:'OK'}]};}}};
 installBridge(ctx);const connection=new DshConnection(),base=`http://127.0.0.1:${server.address().port}/muse-multi-agent/bridge/`;
 const post=(action,body,headers={})=>fetch(base+action,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  assert.equal((await post('pair-code',{})).status,403);
  const pair=await(await post('pair-code',{}, {'X-Muse-UI':'1'})).json();await connection.pair(pair.code);
  assert.equal((await post('claim',{code:pair.code.split(':')[1]})).status,403);
  assert.deepEqual(await connection.tools('role'),[]);await connection.grant('role','agent',['read']);assert.equal((await connection.tools('role')).length,1);assert.deepEqual(await connection.tools('other'),[]);
  await assert.rejects(connection.invoke('other','chat','call','read',{},new AbortController().signal));assert.equal(count,0);
  await connection.invoke('role','chat','call','read',{},new AbortController().signal);assert.equal(count,1);
  await assert.rejects(connection.invoke('role','chat','call','read',{},new AbortController().signal));assert.equal(count,1);
  ctx.tools.execute=async input=>{input.signal.throwIfAborted();await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));};
  const pending=connection.invoke('role','chat','pending','read',{},new AbortController().signal);pending.catch(()=>{});await new Promise(r=>setTimeout(r,20));
  await connection.grant('role','agent',[]);await assert.rejects(pending);await assert.rejects(connection.invoke('role','chat','next','read',{},new AbortController().signal));
  const again=await(await post('pair-code',{}, {'X-Muse-UI':'1'})).json();
  await connection.pair(again.code);assert.deepEqual(await connection.tools('role'),[]);
  await connection.grant('role','agent',['read']);assert.equal((await connection.tools('role')).length,1);
  await assert.rejects(connection.pair(again.code));assert.equal((await connection.tools('role')).length,1);
  await connection.revoke();assert.equal(connection.token,null);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('模型工具循环：结构化调用、结果回传、审计先落盘、未授权工具拒绝',async()=>{
 const tools=[{name:'read',parameters:{type:'object',properties:{}}}],events=[];let requests=0;
 const result=await completeWithTools({name:'测试',model:'deepseek-chat',temperature:0,maxTokens:100},[{role:'user',content:'读取'}],'fake',{tools,signal:new AbortController().signal,record:async r=>events.push(structuredClone(r)),invoke:async()=>{assert.equal(events.at(-1).status,'running');return {text:'OK'};},fetchImpl:async(url,init)=>{
  const body=JSON.parse(init.body);requests++;if(requests===1)return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:'read',arguments:'{}'}}]}}]})};
  assert.equal(body.messages.at(-1).role,'tool');assert.equal(body.messages.at(-1).tool_call_id,'call');return {ok:true,json:async()=>({choices:[{message:{content:'已读取 OK'},finish_reason:'stop'}]})};
 }});assert.equal(result.content,'已读取 OK');assert.equal(events.at(-1).status,'completed');
 await assert.rejects(completeWithTools({name:'测试'},[],'fake',{tools,signal:new AbortController().signal,record:async()=>assert.fail(),invoke:async()=>assert.fail(),fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:'write',arguments:'{}'}}]}}]})})}),/未授权/);
});
