// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {installBridge} from '../plugin/bridge.mjs';
import {DshConnection} from '../src/dsh-connection.mjs';
import {completeWithTools} from '../src/tool-completion.mjs';

test('自动接入发现以后新增工具、跟随更新与卸载，保留作用域和按项授权限制',async()=>{
 let handler,executions=0,beforeJob=()=>{},schemas=[{name:'read',description:'v1',parameters:{type:'object'}}];
 const agent={id:'agent',runMaintenance:job=>{beforeJob();return job(new AbortController().signal);}};
 const server=http.createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 installBridge({effect:f=>f(),webServer:{port:server.address().port,register:r=>{handler=r.handler;return()=>{};}},agents:{list:()=>[agent],get:id=>id===agent.id?agent:null},tools:{schemas:a=>{assert.equal(a,agent);return schemas;},execute:async input=>{assert.equal(input.agent,agent);executions++;return {content:[]};}}});
 const d=new DshConnection(),base=`http://127.0.0.1:${server.address().port}/muse-multi-agent/bridge/`;
 try{
  const p=await(await fetch(base+'pair-code',{method:'POST',headers:{'X-Muse-UI':'1'},body:'{}'})).json();await d.pair(p.code);
  await d.grant('fixed',agent.id,['read']);await d.grant('auto',agent.id,[],true);
  assert.equal(d.grants.get('auto').allTools,true);assert.deepEqual(await d.tools('other'),[]);
  schemas=[{...schemas[0],description:'v2'},{name:'new_plugin_tool',parameters:{type:'object'}},{name:'muse_bridge_status',parameters:{type:'object'}}];
  assert.deepEqual((await d.tools('auto')).map(t=>t.name),['read','new_plugin_tool']);
  await d.invoke('auto','chat','new','new_plugin_tool',{},AbortSignal.timeout(2000));
  await d.invoke('auto','chat','changed','read',{},AbortSignal.timeout(2000));
  await assert.rejects(d.invoke('fixed','chat','fixed-changed','read',{},AbortSignal.timeout(2000)),/定义已改变/);
  await assert.rejects(d.invoke('fixed','chat','fixed-new','new_plugin_tool',{},AbortSignal.timeout(2000)),/未授权/);
  await assert.rejects(d.invoke('auto','chat','own','muse_bridge_status',{},AbortSignal.timeout(2000)),/未授权/);
  const before=executions;schemas=schemas.filter(t=>t.name!=='new_plugin_tool');
  assert.equal((await d.tools('auto')).some(t=>t.name==='new_plugin_tool'),false);
  await assert.rejects(d.invoke('auto','chat','removed','new_plugin_tool',{},AbortSignal.timeout(2000)),/工具不可用/);assert.equal(executions,before);
  schemas=Array.from({length:80},(_,i)=>({name:'tool_'+i,parameters:{type:'object'}}));assert.equal((await d.tools('auto')).length,80);
  beforeJob=()=>{schemas=[];};await assert.rejects(d.invoke('auto','chat','queued','tool_0',{},AbortSignal.timeout(2000)),/排队期间/);assert.equal(executions,before);
  await d.grant('auto',agent.id,[]);assert.deepEqual(await d.tools('auto'),[]);await assert.rejects(d.invoke('auto','chat','revoked','tool_0',{},AbortSignal.timeout(2000)),/未授权/);
 }finally{await d.revoke();await new Promise(r=>server.close(r));}
});

test('旧宿主不能静默接受自动模式，必须明确支持',async()=>{
 const d=new DshConnection();d.request=async()=>({ok:true});
 await assert.rejects(d.grant('role','agent',[],true),/不支持自动接入/);assert.equal(d.grants.size,0);
});

test('同一轮模型往返刷新目录，新增工具无需重新授权即可被选择',async()=>{
 let rounds=0,refreshes=0;const called=[];
 const read={name:'read',parameters:{type:'object'}},added={name:'new_plugin_tool',parameters:{type:'object'}};
 const response=message=>({ok:true,json:async()=>({choices:[{message}]})});
 const call=name=>({tool_calls:[{id:name,type:'function',function:{name,arguments:'{}'}}]});
 const result=await completeWithTools({name:'自动工具测试'},[],'fake',{
  tools:[read],refreshTools:async()=>{refreshes++;return refreshes===1?[read,added]:[];},signal:AbortSignal.timeout(2000),record:async()=>{},invoke:async(_id,name)=>{called.push(name);return {text:'OK'};},
  fetchImpl:async(_url,init)=>{const body=JSON.parse(init.body);rounds++;
   if(rounds===1){assert.deepEqual(body.tools.map(t=>t.function.name),['read']);return response(call('read'));}
   if(rounds===2){assert.deepEqual(body.tools.map(t=>t.function.name),['read','new_plugin_tool']);return response(call('new_plugin_tool'));}
   assert.equal(body.tools,undefined);assert.equal(body.tool_choice,undefined);return response({content:'新增插件调用完成'});
  },
 });
 assert.equal(result.content,'新增插件调用完成');assert.deepEqual(called,['read','new_plugin_tool']);assert.equal(refreshes,2);
});
