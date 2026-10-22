// SPDX-License-Identifier: GPL-3.0-or-later
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {MemoryLibrary} from '../src/memory-library.mjs';
const data=resolve(process.argv[2]||fileURLToPath(new URL('../data/',import.meta.url)));
const root=resolve(process.argv[3]||fileURLToPath(new URL('../../memory/',import.meta.url)));
const store=new Store(data);await store.init();const library=new MemoryLibrary({root,store});await library.init();
const roles=await store.list('characters'),chats=await store.list('chats'),report={createdAt:new Date().toISOString(),data,root,roles:[],legacy:{messages:0,chats:0,unmapped:[]}};
const stableId=value=>{const d=createHash('sha256').update(value).digest('hex');return `${d.slice(0,8)}-${d.slice(8,12)}-4${d.slice(13,16)}-a${d.slice(17,20)}-${d.slice(20,32)}`;};
let backup;
try{backup=JSON.parse(await readFile(join(data,'phone-import','muse-backup-import-ready.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(backup){
  for(const assistant of backup.assistants||[]){
    const candidates=[];for(const role of roles){const memory=await store.get('memories',role.id);if(!role.deletedAt&&role.name===assistant.name&&memory?.sourceRoleId===assistant.id)candidates.push(role);}
    if(candidates.length!==1){report.legacy.unmapped.push({id:assistant.id,name:assistant.name});continue;}
    const role=candidates[0],dir=join(root,library.catalog.roles[role.id].folder),owned=chats.filter(c=>c.characterId===role.id);
    const ids=new Set(owned.flatMap(c=>c.messages.map(m=>m.id))),texts=new Set(owned.flatMap(c=>c.messages.map(m=>JSON.stringify([m.role,m.createdAt,m.content]))));
    for(const session of backup.sessions||[]){
      // Legacy default sessions omitted assistantId. Never infer other ownership.
      if((session.assistantId||'default')!==assistant.id)continue;
      const missing=(backup.messages||[]).filter(m=>m.sessionId===session.id&&!ids.has(m.id)&&!texts.has(JSON.stringify([m.role.toLowerCase(),m.createdAt,m.content])));
      if(!missing.length)continue;
      const digest=createHash('sha256').update('phone-archive:'+role.id+':'+session.id).digest('hex'),id=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
      const archive={schemaVersion:1,id,characterId:role.id,characterName:role.name,title:session.title,createdAt:session.createdAt,updatedAt:session.updatedAt,legacyArchive:true,archivePrefix:'旧备份-',sourceSessionId:session.id,sourceFile:'muse-backup-import-ready.json',
        deletedAt:backup.exportedAt||session.updatedAt,archiveNote:'当前库缺失的旧备份消息。无法判断是否曾主动删除，因此仅保存档案，不参与自动检索，不恢复到应用聊天列表。',messages:missing.map(m=>({id:m.id,role:m.role.toLowerCase(),content:m.content,createdAt:m.createdAt}))};
      await writeFile(join(dir,'对话记录',`旧备份-${id}.json`),JSON.stringify(archive,null,2)+'\n');
      await writeFile(join(dir,'对话记录',`旧备份-${id}.md`),`# ${session.title} · 旧备份补档\n\n${archive.archiveNote}\n\n原聊天 ID：${session.id}\n\n`+archive.messages.map(m=>`## ${m.role} · ${new Date(m.createdAt).toISOString()}\n\n消息 ID：${m.id}\n\n${m.content}`).join('\n\n')+'\n');
      report.legacy.messages+=missing.length;report.legacy.chats++;
    }
  }
  // A missing assistant definition must never be guessed from conversation text.
  const unknownIds=[...new Set((backup.sessions||[]).map(s=>s.assistantId||'default'))].filter(id=>!(backup.assistants||[]).some(a=>a.id===id));
  for(const sourceRoleId of unknownIds){
    const id=stableId('unidentified-phone-role:'+sourceRoleId),role={schemaVersion:1,id,name:'未识别历史 AI',createdAt:backup.exportedAt,updatedAt:backup.exportedAt,deletedAt:backup.exportedAt,sourceRoleId,archiveNote:`原身份编号：${sourceRoleId}。旧手机备份缺少对应角色定义，用户也无法确认名字；人格未知，不推断、不合并，仅保留历史档案。`};
    const archived=(backup.sessions||[]).filter(s=>s.assistantId===sourceRoleId).map(s=>({schemaVersion:1,id:s.id,characterId:id,characterName:role.name,title:s.title,createdAt:s.createdAt,updatedAt:s.updatedAt,deletedAt:backup.exportedAt,legacyArchive:true,sourceSessionId:s.id,sourceFile:'muse-backup-import-ready.json',messages:(backup.messages||[]).filter(m=>m.sessionId===s.id).map(m=>({id:m.id,role:m.role.toLowerCase(),content:m.content,createdAt:m.createdAt}))}));
    await library.syncRole(role,archived);library.catalog.roles[id].archivedOnly=true;library.catalog.roles[id].sourceRoleId=sourceRoleId;
    const count=archived.reduce((n,c)=>n+c.messages.length,0);report.legacy.messages+=count;report.legacy.chats+=archived.length;
    report.roles.push({id,name:role.name,sourceRoleId,folder:join(root,library.catalog.roles[id].folder),archivedOnly:true,chats:archived.length,messages:count,memories:0,verified:true});
    for(const c of archived){const saved=JSON.parse(await readFile(join(root,library.catalog.roles[id].folder,'对话记录',c.id+'.json'),'utf8'));if(JSON.stringify(saved)!==JSON.stringify(c))throw Error('未识别身份档案校验失败');}
  }
}
await library.syncAll();
for(const role of roles){
  const dir=join(root,library.catalog.roles[role.id].folder),owned=chats.filter(c=>c.characterId===role.id),memory=await store.get('memories',role.id);
  for(const chat of owned){const copy=JSON.parse(await readFile(join(dir,'对话记录',chat.id+'.json'),'utf8'));if(JSON.stringify(copy)!==JSON.stringify(chat))throw Error('聊天副本校验失败：'+chat.id);}
  const savedRole=JSON.parse(await readFile(join(dir,'人格.json'),'utf8'));if(JSON.stringify(savedRole)!==JSON.stringify(role))throw Error('人格副本校验失败');
  if(memory&&JSON.stringify(JSON.parse(await readFile(join(dir,'长期记忆.json'),'utf8')))!==JSON.stringify(memory))throw Error('长期记忆副本校验失败');
  report.roles.push({id:role.id,name:role.name,folder:dir,deleted:!!role.deletedAt,chats:owned.length,messages:owned.reduce((n,c)=>n+c.messages.length,0),memories:memory?.records.length||0,verified:true});
}
await writeFile(join(root,'迁移报告.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(join(root,'使用说明.md'),await readFile(fileURLToPath(new URL('../docs/MEMORY_LIBRARY.md',import.meta.url)),'utf8'));
console.log(JSON.stringify(report,null,2));
