// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CapabilityRouter} from '../src/capability-router.mjs';
import {createDshScopeAdapter} from '../plugin/scope-adapter.mjs';
test('角色工具默认拒绝、按角色授权、撤销与卸载；调用携带身份',async()=>{
 const router=new CapabilityRouter();let calls=0;
 const dispose=router.register('dsh',{list:async()=>[{name:'search',parameters:{}}],invoke:async input=>{calls++;assert.equal(input.roleId,'a');assert.equal(input.chatId,'chat');assert.ok(input.callId);return {text:'result'};}});
 assert.deepEqual(await router.list('a'),[]);await assert.rejects(router.invoke({roleId:'a',chatId:'chat',provider:'dsh',tool:'search',args:{}}));
 router.grant('a','dsh','search');assert.equal((await router.list('a')).length,1);assert.equal((await router.list('b')).length,0);
 assert.equal((await router.invoke({roleId:'a',chatId:'chat',provider:'dsh',tool:'search',args:{}})).result.text,'result');
 await assert.rejects(router.invoke({roleId:'a',chatId:'chat',provider:'dsh',tool:'search',args:{},signal:AbortSignal.abort()}));assert.equal(calls,1);
 router.revoke('a','dsh','search');await assert.rejects(router.invoke({roleId:'a',chatId:'chat',provider:'dsh',tool:'search',args:{}}));
 router.grant('a','dsh','search');dispose();assert.deepEqual(await router.list('a'),[]);
});
test('DSH 适配器仅使用绑定作用域与正式调度接口',async()=>{
 const agent={id:'bound-agent'},calls=[];
 const adapter=createDshScopeAdapter({tools:{schemas:scope=>{assert.equal(scope,agent);return [{name:'search'},{name:'muse_bridge_status'}];},get:()=>{throw new Error('Must not bypass dispatch');},execute:async input=>{calls.push(input);return {status:'ok'};}}},async role=>role==='a'?agent:null);
 assert.deepEqual((await adapter.list({roleId:'a'})).map(t=>t.name),['search']);await assert.rejects(adapter.list({roleId:'b'}));
 await adapter.invoke({roleId:'a',chatId:'chat',callId:'call',tool:'search',args:{q:'test'},signal:new AbortController().signal});assert.equal(calls[0].agent,agent);assert.equal(calls[0].parent,undefined);
 await assert.rejects(adapter.invoke({roleId:'a',chatId:'chat',callId:'call',tool:'muse_bridge_status',args:{},signal:new AbortController().signal}));
});
