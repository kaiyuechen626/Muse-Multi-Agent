// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {character,exportCard,importCard} from '../src/characters.mjs';
import {createApp} from '../src/server.mjs';
test('角色卡字段往返：空人设、后置指令、图片及隐私字段隔离',()=>{
 const role=character({name:'导出测试',persona:'',systemPrompt:'独立系统提示',postHistory:'后置指令',scenario:'背景',greeting:'你好',examples:'示例',avatar:'data:image/png;base64,YQ==',background:'data:image/webp;base64,Yg==',model:'deepseek-reasoner',temperature:0,maxTokens:4096});
 Object.assign(role,{apiKey:'PRIVATE',memories:['PRIVATE'],messages:['PRIVATE'],cardMetadata:{secret:'PRIVATE'}});
 const card=exportCard(role),restored=importCard(JSON.parse(JSON.stringify(card))).character;
 for(const [key,value] of Object.entries(card.assistant))assert.deepEqual(restored[key],value);
 assert.notEqual(restored.id,role.id);assert.ok(!JSON.stringify(card).includes('PRIVATE'));assert.ok(!('id' in card.assistant));
 assert.throws(()=>importCard({...card,spec_version:'2.0'}));
});
test('导出接口提供下载，导入后新建角色且不修改原角色',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-role-export-'));const server=await createApp({dataDir:root});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/`;
 const request=(path,method='GET',data)=>fetch(base+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
 try{
  const role=await (await request('characters','POST',{name:'角色测试',persona:'人设',postHistory:'后置'})).json();
  assert.equal((await (await request(`characters/${role.id}`,'PUT',{pinned:true})).json()).pinned,true);
  assert.equal((await (await request(`characters/${role.id}`,'PUT',{name:'角色测试修改'})).json()).pinned,true);
  assert.equal((await (await request('backup')).json()).characters.find(r=>r.id===role.id).pinned,true);
  assert.equal((await request(`characters/${role.id}`,'PUT',{pinned:'true'})).status,400);
  const response=await request(`characters/${role.id}/export`);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);
  const card=await response.json(),preview=await (await request('import','POST',card)).json();assert.equal(preview.character.postHistory,'后置');
  const restored=await (await request('characters','POST',{...preview.character,importCard:card})).json();assert.notEqual(restored.id,role.id);
  assert.equal(restored.pinned,false);
  assert.equal((await (await request(`characters/${role.id}`,'PUT',{pinned:false})).json()).pinned,false);
  assert.equal((await (await request('characters')).json()).length,2);
  assert.equal((await request('characters/00000000-0000-0000-0000-000000000000/export')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
