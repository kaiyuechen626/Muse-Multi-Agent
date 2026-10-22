// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {requestDshPairing} from '../web/dsh-settings.js';

test('内嵌配对只接受宿主来源、窗口和本次请求，超时清理监听',async()=>{
 let receive,timeout,cleared=false,sent;
 const parent={postMessage:(data,origin)=>{sent={data,origin};}};
 const win={parent,location:{search:'?embed=dsh'},crypto:{randomUUID:()=> 'request'},setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{cleared=true;},addEventListener:(_,fn)=>{receive=fn;},removeEventListener:(_,fn)=>{assert.equal(fn,receive);receive=null;}};
 const promise=requestDshPairing(win),code='19387:'+ 'a'.repeat(48);
 assert.equal(sent.origin,'dsh-app://app');
 const valid={source:parent,origin:'dsh-app://app',data:{type:'muse:pair-result',requestId:'request',code}};
 for(const event of [{...valid,origin:'https://evil.test'},{...valid,source:{}},{...valid,data:{...valid.data,requestId:'old'}}])receive(event);
 assert.equal(cleared,false);receive(valid);assert.equal(await promise,code);assert.equal(receive,null);
 const expired=requestDshPairing(win);timeout();await assert.rejects(expired,/未响应/);assert.equal(receive,null);
 await assert.rejects(requestDshPairing({...win,parent:win,location:{search:''}}),/手动/);
});

test('DSH 配对宿主只响应自己的 Muse iframe，卸载后不发凭据',async()=>{
 let module,listener,cleanups=[],fetches=0,resolveFetch;const messages=[];
 const frame={contentWindow:{postMessage:(data,origin)=>messages.push({data,origin})}};
 const React={useRef:()=>({current:frame}),useState:v=>[v,()=>{}],useEffect:fn=>{cleanups.push(fn());},createElement:(type,props,...children)=>({type,props,children})};
 vm.runInNewContext(await readFile(new URL('../plugin/client.js',import.meta.url),'utf8'),{
  window:{__ModuleLoader__:{load:value=>{module=value;}},addEventListener:(_,fn)=>{listener=fn;},removeEventListener:()=>{listener=null;}},
  fetch:async url=>{if(url.includes('pair-code')){fetches++;return new Promise(r=>{resolveFetch=r;});}return {ok:true,json:async()=>({connected:true})};},AbortSignal,React,
 });
 const plugin=module.factory(()=>React);let panel;
 plugin.apply({slots:{inject:(_,fn)=>fn(),register:(config,component)=>{if(config.name==='main')panel=component;}},layout:{}});panel({close:()=>{}});
 const event={source:frame.contentWindow,origin:'http://127.0.0.1:3210',data:{type:'muse:pair-request',requestId:'one'}};
 for(const bad of [{...event,origin:'https://evil.test'},{...event,source:{}}])await listener(bad);
 assert.equal(fetches,0);
 const pending=listener(event);await listener(event);assert.equal(fetches,1);
 resolveFetch({ok:true,json:async()=>({code:'secret'})});await pending;
 assert.equal(messages.length,1);assert.equal(messages[0].origin,'http://127.0.0.1:3210');assert.equal(messages[0].data.requestId,'one');
 const late=listener(event);cleanups.filter(Boolean).forEach(fn=>fn());resolveFetch({ok:true,json:async()=>({code:'secret'})});await late;assert.equal(messages.length,1);assert.equal(listener,null);
});

