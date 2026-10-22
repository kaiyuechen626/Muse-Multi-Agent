// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {character} from '../src/characters.mjs';
import {LanSync} from '../src/lan-sync.mjs';
import {createApp} from '../src/server.mjs';
import {once} from 'node:events';
import {createGroupChat} from '../src/group-chat.mjs';
const change=(kind,body,baseRevision=0)=>({kind,id:body.id,opId:randomUUID(),baseRevision,body});
const input=(changes=[],extra={})=>({cursor:0,changes,...extra});
const fact=(text,id=randomUUID(),importance=1)=>({id,text,category:'preference',createdAt:1,importance});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'muse-identities-')),store=new Store(dir);await store.init();const sync=new LanSync({store,port:0,discoveryPort:0});await sync.init();
 const device=randomUUID();sync.state.devices[device]={name:'隔离手机'};
 t.after(async()=>{await sync.stop();await rm(dir,{recursive:true,force:true});});return {dir,store,sync,device};
}
test('同名先询问，分别保留记住选择，重启也不重复询问',async t=>{
 const {store,sync,device}=await fixture(t),a=character({name:'Muse'}),b=character({name:'  Ｍｕｓｅ  '});await store.put('characters',a);
 const packet=input([change('characters',b)]),pending=await sync.exchange(device,packet);assert.equal(pending.nameMatches.length,1);assert.equal(pending.acks.length,0);assert.equal(await store.get('characters',b.id),null);
 await sync.resolveNameMatch(pending.nameMatches[0].id,false);const accepted=await sync.exchange(device,packet);assert.equal(accepted.nameMatches.length,0);assert.equal(accepted.acks.length,1);assert.equal((await store.list('characters')).length,2);
 const restarted=new LanSync({store,port:0,discoveryPort:0});await restarted.init();t.after(()=>restarted.stop());assert.equal((await restarted.exchange(device,input([], {roleInventory:[{id:b.id,name:b.name}]}))).nameMatches.length,0);
});
test('确认合并保留本地授权，汇总聊天记忆，保存设定冲突及原始备份，重试不重复',async t=>{
 const {store,sync,device}=await fixture(t),a=character({name:'同名',systemPrompt:'电脑设定',apiKey:'PC-PRIVATE'}),b=character({name:'同名',systemPrompt:'手机设定',apiKey:'LOCAL-PRIVATE'});
 a.apiKey='PC-PRIVATE';b.apiKey='LOCAL-PRIVATE';await store.put('characters',a);await store.put('characters',b);
 const f=fact('同一记忆');await store.put('memories',{id:a.id,characterId:a.id,records:[f]});await store.put('memories',{id:b.id,characterId:b.id,records:[fact('同一记忆',randomUUID(),2),fact('手机独有')]});
 const chat={id:randomUUID(),characterId:b.id,characterName:b.name,title:'手机聊天',createdAt:1,updatedAt:1,messages:[]};await store.put('chats',chat);
 const result=await sync.exchange(device,input([], {roleInventory:[{id:b.id,name:b.name}]})),question=result.nameMatches[0];assert.equal(question.targetId,a.id);assert.equal(JSON.stringify(question).includes('PRIVATE'),false);
 await sync.resolveNameMatch(question.id,true);await sync.resolveNameMatch(question.id,true);
 assert.equal(await store.get('characters',b.id),null);assert.equal((await store.get('characters',a.id)).apiKey,'PC-PRIVATE');assert.equal((await store.get('chats',chat.id)).characterId,a.id);
 const records=(await store.get('memories',a.id)).records;assert.equal(records.length,2);assert.equal(records.find(r=>r.text==='同一记忆').importance,2);assert.equal(sync.state.mergeVersion,1);assert.equal(sync.state.conflicts.length,1);
 const files=await readdir(join(sync.folder,'identity-merges'));assert.equal(files.length,1);const plan=JSON.parse(await readFile(join(sync.folder,'identity-merges',files[0])));assert.equal(plan.originals.find(o=>o.kind==='characters'&&o.value.id===b.id).value.apiKey,'LOCAL-PRIVATE');
 const directive=await sync.exchange(device,input());assert.deepEqual(directive.roleMerges,[{from:b.id,to:a.id}]);
 const phoneMem={id:a.id,characterId:a.id,records:[fact('手机首次上传'),fact('同一记忆')]};const batch=input([change('memories',phoneMem)],{roleMergeVersion:1,identityMergeVersion:1});
 const seeded=await sync.exchange(device,batch);assert.equal(seeded.acks[0].body.records.length,3);assert.deepEqual((await sync.exchange(device,batch)).acks,seeded.acks);
 await sync.exchange(device,input([], {roleMergeVersion:1,identityMergeVersion:1,completeIdentityMerge:true}));assert.equal(sync.state.devices[device].mergeBootstrap,undefined);
 const third=randomUUID();sync.state.devices[third]={name:'新手机'};await sync.exchange(third,input());assert.equal(sync.state.devices[third].mergeBootstrap.version,1);
 const x=character({name:'第二组'}),y=character({name:'第二组'});await store.put('characters',x);
 const pending2=await sync.exchange(device,input([change('characters',y)],{roleMergeVersion:1}));await sync.resolveNameMatch(pending2.nameMatches[0].id,true);
 const late=randomUUID();sync.state.devices[late]={name:'已配对但尚未拉取映射',mergeBootstrap:{version:2,targets:[x.id],seeded:{}}};await sync.exchange(late,input());assert.ok(sync.state.devices[late].mergeBootstrap.targets.includes(a.id));
 await assert.rejects(sync.exchange(device,input([change('characters',b)],{roleMergeVersion:2})),/角色已经合并/);
});
test('中途写入失败可从合并日志恢复，不丢失原始记录',async t=>{
 const {store,sync,device}=await fixture(t),a=character({name:'恢复测试'}),b=character({name:'恢复测试'});await store.put('characters',a);await store.put('characters',b);
 await store.put('memories',{id:b.id,characterId:b.id,records:[fact('保留记忆')]});const pending=await sync.exchange(device,input([], {roleInventory:[{id:b.id,name:b.name}]}));
 const put=store.put.bind(store);let fail=true;store.put=async(kind,value)=>{if(fail&&kind==='memories'){fail=false;throw Error('模拟断电');}return put(kind,value);};
 await assert.rejects(sync.resolveNameMatch(pending.nameMatches[0].id,true),/模拟断电/);assert.equal(sync.hasPendingIdentityMerge(),true);store.put=put;
 const restarted=new LanSync({store,port:0,discoveryPort:0});await restarted.init();t.after(()=>restarted.stop());assert.equal(restarted.hasPendingIdentityMerge(),false);assert.equal((await store.get('memories',a.id)).records[0].text,'保留记忆');assert.equal(await store.get('characters',b.id),null);assert.equal(restarted.state.roleAliases[b.id],a.id);
 await restarted.identities.recover();assert.equal((await store.get('memories',a.id)).records.length,1);assert.equal(restarted.state.mergeVersion,1);
});
test('等待选择时手机改名会取消旧提示，三个同名身份按映射链收敛',async t=>{
 const {store,sync,device}=await fixture(t),a=character({name:'同名'}),b=character({name:'同名'});await store.put('characters',a);
 await sync.exchange(device,input([change('characters',b)]));b.name='已改名';let reply=await sync.exchange(device,input([change('characters',b)]));assert.equal(reply.nameMatches.length,0);assert.equal(reply.acks.length,1);
 b.name='同名';await store.put('characters',b);reply=await sync.exchange(device,input([], {roleInventory:[{id:b.id,name:b.name}]}));await sync.resolveNameMatch(reply.nameMatches[0].id,true);
 const c=character({name:'同名'});await store.put('characters',c);reply=await sync.exchange(device,input([], {roleMergeVersion:1,roleInventory:[{id:a.id,name:a.name}]}));await sync.resolveNameMatch(reply.nameMatches[0].id,true);
 const aliases=(await sync.exchange(device,input())).roleMerges;assert.ok(aliases.every(m=>m.to===c.id));assert.equal(sync.identities.canonical(b.id),c.id);
});
test('电脑确认接口通过当前请求锁完成合并，重复确认幂等',async t=>{
 const {dir,store,sync,device}=await fixture(t),a=character({name:'接口测试'}),b=character({name:'接口测试'});await store.put('characters',a);
 const pending=await sync.exchange(device,input([change('characters',b)]));await sync.save();
 const server=await createApp({dataDir:dir});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const url='http://127.0.0.1:'+server.address().port+'/api/lan-sync/name-match',packet={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pending.nameMatches[0].id,merge:true})};
  const response=await fetch(url,packet);assert.equal(response.status,200);const state=await response.json();assert.equal(state.nameMatches.length,0);assert.equal(state.roleMerges[0].to,a.id);
  assert.equal((await fetch(url,packet)).status,200);assert.equal((await store.list('characters')).length,1);
 }finally{await new Promise(r=>server.close(r));}
});

test('电脑聊天室随角色身份合并更新非首位成员，但拒绝合并同室的两位成员',async t=>{
 const {store,sync,device}=await fixture(t),a=character({name:'同名'}),b=character({name:'同名'}),c=character({name:'另一位'});
 for(const role of [a,b,c])await store.put('characters',role);
 const active=id=>store.get('characters',id),room=await createGroupChat({characterIds:[c.id,b.id]},active),userId=randomUUID();
 room.messages=[{id:userId,role:'user',content:'你好',createdAt:1},{id:randomUUID(),role:'assistant',characterId:b.id,characterName:b.name,content:'你好呀',createdAt:2,turnUserMessageId:userId}];
 room.pendingTurn={userMessageId:userId,characterIds:[b.id,c.id],completedIds:[b.id]};await store.put('chats',room);
 const result=await sync.exchange(device,input([], {roleInventory:[{id:b.id,name:b.name}]}));await sync.resolveNameMatch(result.nameMatches[0].id,true);
 const merged=await store.get('chats',room.id);assert.equal(merged.characterId,c.id);assert.equal(merged.participants[1].characterId,a.id);assert.equal(merged.messages[1].characterId,a.id);assert.deepEqual(merged.pendingTurn.completedIds,[a.id]);assert.equal(sync.state.rows['chats:'+room.id].body.participants[1].characterId,a.id);
 const d=character({name:'同名'});await store.put('characters',d);await store.put('chats',await createGroupChat({characterIds:[a.id,d.id]},active));
 const second=await sync.exchange(device,input([], {roleMergeVersion:1,roleInventory:[{id:d.id,name:d.name}]}));
 await assert.rejects(sync.resolveNameMatch(second.nameMatches[0].id,true),/同一电脑聊天室/);assert.ok(await store.get('characters',d.id));assert.equal(sync.hasPendingIdentityMerge(),false);
 await sync.resolveNameMatch(second.nameMatches[0].id,false);
});
