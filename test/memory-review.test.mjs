// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewMemories,mergeReviewedMemories } from '../src/memory-review.mjs';
import { createApp } from '../src/server.mjs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import {appendAutomaticMemory} from '../src/automatic-memory.mjs';

test('质量分类区分否定、数字、重复，采用单条时保留其有效期',()=>{
 const records=[{id:'a',text:'用户喜欢茶',revision:1,validUntil:10},{id:'b',text:'用户不喜欢茶',revision:1,validUntil:null},{id:'c',text:'用户每天喝1.5升水',revision:1},{id:'d',text:'用户每天喝15升水',revision:1}];
 const result=reviewMemories({records});assert.equal(result.pairs.filter(p=>p.kind==='conflict').length,2);assert.ok(!result.pairs.some(p=>p.exact));
 const kept=mergeReviewedMemories({records},{records:records.slice(0,2).map(r=>({id:r.id,revision:1})),text:records[1].text,keepId:'b'});assert.equal(kept.records.at(-1).validUntil,null);
 assert.throws(()=>mergeReviewedMemories({records},{records:records.slice(0,2).map(r=>({id:r.id,revision:1})),text:'随意文本',keepId:'b'}));
 const added=appendAutomaticMemory({records:[records[2]]},[{text:records[3].text},{text:'用户每天喝１．５升水。'}],{chatId:'c',messageId:'m'});assert.equal(added.added,1);
});

test('来源追溯：同角色校验、合并后追溯、完整备份保留及回收站状态',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-sources-')),server=await createApp({dataDir:root});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}/api/`,req=(p,method='GET',body)=>fetch(base+p,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined}),json=async(...args)=>{const r=await req(...args);assert.ok(r.ok,await r.clone().text());return r.json();};
 try{
  const role=await json('characters','POST',{name:'来源测试',greeting:'原始消息'}),other=await json('characters','POST',{name:'其他角色'}),chat=await json('chats','POST',{characterId:role.id});
  const source={sourceChatId:chat.id,sourceMessageId:chat.messages[0].id},path=`characters/${role.id}/memories`;
  assert.equal((await req(`characters/${other.id}/memories`,'POST',{text:'跨角色',...source})).status,400);
  await json(path,'POST',{text:'用户喜欢茶',...source});const m=await json(path,'POST',{text:'用户不喜欢茶'});
  const merged=await json(path+'/merge','POST',{records:m.records.map(r=>({id:r.id,revision:r.revision})),text:'用户不喜欢茶',keepId:m.records[1].id});
  const endpoint=path+'/'+merged.records[0].id+'/sources';let trace=await json(endpoint);assert.equal(trace.sources[0].content,'原始消息');
  assert.ok((await json('backup')).memories[0].records.some(r=>r.sourceChatId===chat.id));
  assert.equal((await req(`characters/${other.id}/memories/${merged.records[0].id}/sources`)).status,404);
  await json(`chats/${chat.id}`,'DELETE',{updatedAt:chat.updatedAt});trace=await json(endpoint);assert.equal(trace.sources[0].inTrash,true);
  const deleted=(await json('chats?trash=1'))[0];await json(`chats/${chat.id}/purge`,'DELETE',{updatedAt:deleted.updatedAt});assert.equal((await json(endpoint)).sources[0].unavailable,true);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
test('相似候选不等于事实相同；合并保留原文、来源、到期时间及版本检查',()=>{
 const memory={id:'role',records:[{id:'a',text:'用户喜欢喝无糖茶。',revision:1,source:'automatic',validUntil:100},{id:'b',text:'用户喜欢喝无糖茶',revision:2,source:'local',validUntil:200},{id:'c',text:'用户喜欢喝无糖茶',deletedAt:1}]};
 const review=reviewMemories(memory);assert.equal(review.pairs.length,1);assert.equal(review.pairs[0].exact,true);
 const input={records:[{id:'a',revision:1},{id:'b',revision:2}],text:'用户喜欢喝无糖茶。'};
 const merged=mergeReviewedMemories(memory,input);assert.equal(memory.records[0].deletedAt,undefined);assert.ok(merged.records[0].deletedAt);assert.equal(merged.records[0].text,memory.records[0].text);
 assert.equal(merged.records.at(-1).validUntil,100);assert.equal(merged.records.at(-1).mergedFrom[0].source,'automatic');assert.equal(reviewMemories(merged).pairs.length,0);
 assert.throws(()=>mergeReviewedMemories(merged,input),/已变化/);assert.throws(()=>mergeReviewedMemories(memory,{...input,text:' '}));
 assert.throws(()=>mergeReviewedMemories(memory,{...input,records:[input.records[0],input.records[0]]}));
});
test('记忆检查与合并 API：角色隔离、重复合并拒绝、原记录留存',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-review-')),server=await createApp({dataDir:root});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}/api/`;
 const req=(path,method='GET',body)=>fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...a)=>(await req(...a)).json();
 try{
 const role=await json('characters','POST',{name:'测试'}),other=await json('characters','POST',{name:'其他'}),path=`characters/${role.id}/memories`;
 await json(path,'POST',{text:'用户喜欢喝无糖茶。'});await json(path,'POST',{text:'用户喜欢喝无糖茶'});
 const review=await json(path+'/review');assert.equal(review.pairs.length,1);
 const payload={records:[review.pairs[0].left,review.pairs[0].right].map(r=>({id:r.id,revision:r.revision})),text:'用户喜欢无糖茶'};
 assert.equal((await req(`characters/${other.id}/memories/merge`,'POST',payload)).status,400);
 const merged=await json(path+'/merge','POST',payload);assert.equal(merged.records.length,1);assert.equal(merged.records[0].mergedFrom.length,2);
 assert.equal((await req(path+'/merge','POST',payload)).status,400);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
