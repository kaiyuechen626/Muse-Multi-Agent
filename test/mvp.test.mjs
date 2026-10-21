// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { character, importCard, promptMessages } from '../src/characters.mjs';
import { complete } from '../src/provider.mjs';
import { createApp } from '../src/server.mjs';
test('V2 和 Muse JSON 映射、占位符、拒绝错误卡片',()=>{
 const c=importCard({spec:'chara_card_v2',spec_version:'2.0',data:{name:'Muse',description:'描述',personality:'温柔',scenario:'图书馆',first_mes:'你好 {{user}}',mes_example:'{{char}}: 好的',post_history_instructions:'继续扮演 {{char}}',extensions:{test:true},character_book:{entries:[]}}});
 assert.equal(c.character.persona,'描述\n\n温柔');assert.equal(c.warnings.length,1);assert.equal(c.character.cardMetadata.data.extensions.test,true);
 assert.match(promptMessages(c.character,[])[0].content,/Muse: 好的/);
 const m=importCard({name:'测试',systemPrompt:'人设',modelId:'deepseek-chat',customHeadersJson:'secret',presetMessagesJson:'[{"role":"assistant","content":"你好"}]'}).character;
 assert.equal(m.persona,'人设');assert.match(m.examples,/你好/);assert.ok(!JSON.stringify(m).includes('secret'));
 assert.throws(()=>importCard({name:'wrong'}));assert.throws(()=>character({name:'',model:'x'}));assert.throws(()=>character({name:'x',avatar:'javascript:alert(1)'}));
});
test('DeepSeek 请求构建、错误归一化与回复校验',async()=>{
 const role=character({name:'A'});let captured;
 const answer=await complete(role,[{role:'user',content:'hi'}],'test-only',{fetchImpl:async(url,options)=>{captured={url,options};return new Response(JSON.stringify({choices:[{message:{content:'hello'},finish_reason:'length'}]}));}});
 assert.equal(answer.finishReason,'length');assert.equal(captured.url,'https://api.deepseek.com/chat/completions');assert.equal(captured.options.headers.Authorization,'Bearer test-only');assert.equal(JSON.parse(captured.options.body).messages.at(-1).content,'hi');
 await assert.rejects(complete(role,[],'key',{fetchImpl:async()=>new Response('',{status:401})}),/API Key 无效/);
 await assert.rejects(complete(role,[],'key',{fetchImpl:async()=>new Response('{"choices":[]}')}),/有效文本/);
});
test('网络限制、DNS、超时和断连显示可操作错误，不暴露底层密钥',async()=>{
 const role=character({name:'测试'});
 for(const [code,pattern] of [['EACCES',/网络访问被系统限制/],['ENOTFOUND',/DNS/],['UND_ERR_CONNECT_TIMEOUT',/超时/],['ECONNRESET',/连接 DeepSeek 失败/]]) {
  await assert.rejects(complete(role,[],'secret',{fetchImpl:async()=>{throw new TypeError('fetch failed secret',{cause:{code}});}}),pattern);
 }
 await assert.rejects(complete(role,[],'secret',{fetchImpl:async()=>new Response('bad json')}),/无效响应/);
});
test('端到端：独立存储、失败重试、重启、编辑删除与同源保护',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-mvp-'));let calls=0;
 const provider=async()=>{if(++calls===1)throw new Error('模拟网络失败');return {content:'你好，已经收到。',finishReason:'stop'};};
 let server;
 async function start(){server=await createApp({dataDir:root,provider});server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
 const stop=()=>new Promise(resolve=>server.close(resolve));
 let base=await start();
 async function req(path,method='GET',body){const r=await fetch(base+'/api/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 try{
  assert.equal((await fetch(base)).status,200);
  const c=(await req('characters','POST',{name:'角色',greeting:'你好 {{user}}',persona:'测试'})).data;
  const chat=(await req('chats','POST',{characterId:c.id})).data;assert.equal(chat.messages[0].content,'你好 用户');
  assert.equal((await req(`chats/${chat.id}/messages`,'POST',{content:'hi'})).status,400);
  await req('settings','PUT',{apiKey:'test-only-key'});
  assert.equal((await req(`chats/${chat.id}/messages`,'POST',{content:'hi'})).status,502);
  assert.equal((await req(`chats/${chat.id}`)).data.messages.length,2);
  assert.equal((await req(`chats/${chat.id}/messages`,'POST',{content:'duplicate'})).status,400);
  const retried=await req(`chats/${chat.id}/messages`,'POST',{retry:true});assert.equal(retried.status,200);assert.equal(retried.data.messages.length,3);
  await req(`characters/${c.id}`,'PUT',{name:'新名称'});assert.equal((await req('characters')).data[0].persona,'测试');
  assert.equal((await readdir(join(root,'characters'))).length,1);assert.equal((await readdir(join(root,'chats'))).length,1);
  assert.ok(!(await readFile(join(root,'characters',c.id+'.json'),'utf8')).includes('test-only-key'));
  assert.ok(!(await readFile(join(root,'chats',chat.id+'.json'),'utf8')).includes('test-only-key'));
  assert.equal((await fetch(base+'/api/characters',{headers:{Origin:'https://evil.example'}})).status,403);
  await stop();base=await start();assert.equal((await req(`chats/${chat.id}`)).data.messages.length,3);
  await req(`characters/${c.id}`,'DELETE');assert.equal((await req(`chats/${chat.id}`)).status,200);
  assert.equal((await req(`chats/${chat.id}/messages`,'POST',{content:'hi'})).status,409);
  await req(`chats/${chat.id}`,'DELETE');assert.equal((await req(`chats/${chat.id}`)).status,409);
  assert.equal((await req('chats?trash=1')).data[0].id,chat.id);
 }finally{await stop();await rm(root,{recursive:true,force:true});}
});
