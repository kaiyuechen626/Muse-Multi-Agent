// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {installWallpaperTools} from '../plugin/wallpaper-tools.mjs';
import {patchWallpaperClient} from '../scripts/install-wallpaper-adapter.mjs';

async function host(timeoutMs=1000){
 let handler;const cleanups=[],tools=new Map();const server=http.createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 installWallpaperTools({effect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup);},tools:{register:t=>tools.set(t.name,t)},webServer:{port:server.address().port,register:r=>{handler=r.handler;return()=>{};}}},t=>t,{timeoutMs});
 const post=(body,headers={})=>fetch(`http://127.0.0.1:${server.address().port}/muse-multi-agent/wallpaper/client`,{method:'POST',headers:{'Content-Type':'application/json','X-Muse-UI':'1',...headers},body:JSON.stringify(body)});
 return {tools,post,close:async()=>{cleanups.forEach(fn=>fn());await new Promise(r=>server.close(r));}};
}
test('壁纸工具仅发给活跃客户端、凭回执完成、单次投递和取消',async()=>{
 const h=await host();const clientId=randomUUID(),signal=new AbortController().signal;
 try{
  await assert.rejects(async()=>h.tools.get('dsh_wallpaper_status').execute({},{signal}),/未连接/);
  assert.equal((await h.post({clientId},{Origin:'https://evil.test'})).status,403);
  await h.post({clientId,visible:true});
  const pending=h.tools.get('dsh_wallpaper_control').execute({action:'clear'},{signal});
  const {commands}=await(await h.post({clientId})).json();assert.equal(commands.length,1);const c=commands[0];
  assert.deepEqual((await(await h.post({clientId})).json()).commands,[]);
  await h.post({clientId,ack:{id:c.id,receipt:'wrong',result:{applied:true}}});
  assert.throws(()=>h.tools.get('dsh_wallpaper_status').execute({},{signal}),/尚未结束/);
  await h.post({clientId,ack:{id:c.id,receipt:c.receipt,result:{applied:true}}});assert.deepEqual(await pending,{applied:true});
  const cancel=new AbortController(),cancelled=h.tools.get('dsh_wallpaper_status').execute({},{signal:cancel.signal});cancel.abort();await assert.rejects(cancelled,/发送前已取消/);
  assert.deepEqual((await(await h.post({clientId})).json()).commands,[]);
  const timeout=h.tools.get('dsh_wallpaper_control').execute({action:'clear'},{signal});await h.post({clientId});await assert.rejects(timeout,/未确认结果/);
 }finally{await h.close();}
});

async function clientHarness(){
 const source=await readFile(new URL('../plugin/wallpaper-client-hook.js',import.meta.url),'utf8');
 const selection={loaded:true,id:'old',type:'image',scrim:.25,wallpaperBlur:0,playbackRate:1,videoVolume:.5,flip:false,objectFit:'cover',rotationEnabled:true,hiddenIds:['hidden'],inventory:{wallpapers:[{id:'old',title:'原背景',type:'image'},{id:'new',title:'新背景',type:'video'},{id:'hidden',title:'隐藏背景',type:'image'}]}};
 let next,request,stop,applyCount=0,writes=0;const context={selection,crypto:{randomUUID},document:{hidden:false},AbortController,
  URL,window:{location:{href:'dsh-app://app/'},setTimeout:fn=>{next=fn;return 1;},clearTimeout:()=>{}},keepPlayingWallpaper:()=>true,
  apiJson:async(path,options)=>{assert.equal(path,'dsh-app://app/muse-multi-agent/wallpaper/client');request=JSON.parse(options.body);return {ok:true,data:{commands:context.commands.splice(0)}};},
  commands:[],applySelection:id=>{applyCount++;selection.id=id;selection.type=id==='new'?'video':'image';},
  persistSelection:()=>{},emit:()=>{},writeLocalCache:()=>{},pushPersisted:async()=>{writes++;},persistTimer:null,persistDirty:false,
 };
 vm.createContext(context);vm.runInContext(source+'\nthis.stop=installMuseWallpaperControl();',context);stop=context.stop;
 await new Promise(r=>setImmediate(r));
 const run=async(action,args)=>{context.commands.push({id:randomUUID(),receipt:'test',action,args});await next();await next();return request.ack;};
 return {context,selection,run,stop,counts:()=>({applyCount,writes})};
}
test('壁纸客户端使用原生选择/保存，范围与隐藏过滤，失败不误报成功',async()=>{
 const h=await clientHarness();
 try{
  const list=await h.run('list',{limit:20});assert.equal(list.result.wallpapers.length,2);
  const invalid=await h.run('control',{action:'select',wallpaper_id:'hidden'});assert.match(invalid.error,/隐藏/);assert.equal(h.counts().writes,0);
  const bad=await h.run('control',{action:'select',wallpaper_id:'new',wallpaper_blur:99});assert.match(bad.error,/范围/);assert.equal(h.selection.id,'old');
  const applied=await h.run('control',{action:'select',wallpaper_id:'new',scrim:.4});assert.equal(applied.result.id,'new');assert.equal(applied.result.persisted,true);assert.equal(h.selection.rotationEnabled,false);assert.equal(h.counts().applyCount,1);
  h.context.persistDirty=true;const failure=await h.run('control',{action:'adjust',scrim:.2});assert.match(failure.error,/保存失败/);assert.equal(failure.result,undefined);
  const clear=await h.run('control',{action:'clear'});assert.match(clear.error,/保存失败/);
 }finally{h.stop();}
});

test('壁纸客户端补丁可重复安装且拒绝不兼容结构',async()=>{
 const source='function applySelection(){} function serializeSelection(){} async function pushPersisted(){} function keepPlayingWallpaper(){} function persistSelection(){} function apply(ctx){} exports.apply = apply;';
 const hook=await readFile(new URL('../plugin/wallpaper-client-hook.js',import.meta.url),'utf8');const patched=patchWallpaperClient(source,hook);
 assert.equal(patchWallpaperClient(patched,hook),patched);assert.match(patched,/ctx.effect\(\(\)=>installMuseWallpaperControl/);assert.throws(()=>patchWallpaperClient('wrong',hook),/不匹配/);
});
