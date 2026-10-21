// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {character} from '../src/characters.mjs';
import {exportFullBackup,previewFullBackup,restoreFullBackup,validateBackup} from '../src/full-backup.mjs';
test('完整备份：密钥排除、来源关系保留、预览不写入、重复跳过及不覆盖',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-full-'));const source=new Store(join(root,'source')),dest=new Store(join(root,'dest'));await source.init();await dest.init();
 try{
 const role=character({name:'测试',persona:'人设'});role.apiKey='SECRET';role.cardMetadata={apiKey:'SECRET'};await source.put('characters',role);
 const parent=randomUUID(),child=randomUUID(),message=randomUUID(),memoryId=randomUUID();
 const c={id:parent,schemaVersion:1,characterId:role.id,characterName:role.name,title:'原聊天',createdAt:1,updatedAt:1,messages:[{id:message,role:'user',content:'你好',createdAt:1}],apiKey:'SECRET'};
 c.messages.push({id:randomUUID(),role:'assistant',content:'回复',createdAt:2,memoryTrace:{version:1,capturedAt:1,records:[{id:memoryId,text:'快照原文',source:'local',revision:1}],expired:0,budgetSkipped:0,limit:24000,used:7}});
 c.summary={text:'摘要正文',coveredCount:1,fingerprint:'a'.repeat(64),updatedAt:2,edited:true};
 await source.put('chats',c);await source.put('chats',{...c,id:child,parentChatId:parent,parentMessageId:message,branchAction:'edit',pinned:true});
 await source.put('memories',{id:role.id,records:[{id:memoryId,text:'删除记录也保留',deletedAt:2,createdAt:1,revision:1}],apiKey:'SECRET'});
 await mkdir(join(source.root,'secrets'));await writeFile(join(source.root,'secrets','deepseek.dpapi'),'SECRET');
 const backup=await exportFullBackup(source);assert.ok(!JSON.stringify(backup).includes('SECRET'));assert.equal(backup.chats.find(c=>c.id===child).parentChatId,parent);assert.equal(backup.memories[0].records[0].deletedAt,2);
 const preview=await previewFullBackup(dest,backup);assert.equal(preview.counts.chats.added,2);assert.equal((await dest.list('characters')).length,0);
 await restoreFullBackup(dest,backup);assert.equal((await dest.get('chats',child)).parentChatId,parent);assert.equal((await dest.get('chats',child)).pinned,true);
 assert.equal((await dest.get('chats',child)).summary.text,'摘要正文');assert.equal((await dest.get('chats',child)).messages[1].memoryTrace.records[0].text,'快照原文');
 const changed=await dest.get('characters',role.id);changed.name='本地修改';await dest.put('characters',changed);
 const result=await restoreFullBackup(dest,backup);assert.equal(result.characters.skipped,1);assert.equal(result.chats.added,0);assert.equal((await dest.get('characters',role.id)).name,'本地修改');
 assert.throws(()=>validateBackup({...backup,chats:[{...backup.chats[0],id:'../../bad'}]}));assert.throws(()=>validateBackup({...backup,characters:[backup.characters[0],backup.characters[0]]}));
 const broken={...backup,chats:[{...backup.chats[0],messages:[{...backup.chats[0].messages[0],role:'system'}]}]};await assert.rejects(restoreFullBackup(dest,broken));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('写入失败回滚本次新增文件，不触碰已有数据',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-full-fail-')),store=new Store(root);await store.init();
 try{const a=character({name:'甲'}),b=character({name:'乙'}),originalPath=store.path.bind(store);await mkdir(join(root,'occupied'));
 const originalGet=store.get.bind(store);store.get=(kind,id)=>id===b.id?Promise.resolve(null):originalGet(kind,id);
 store.path=(kind,id)=>id===b.id?join(root,'occupied'):originalPath(kind,id);
 await assert.rejects(restoreFullBackup(store,{format:'muse-full-backup',schemaVersion:1,exportedAt:1,characters:[a,b],chats:[],memories:[]}));assert.equal(await store.get('characters',a.id),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
