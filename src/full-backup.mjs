// SPDX-License-Identifier: GPL-3.0-or-later
import {writeFile,link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {character} from './characters.mjs';
import {memoryTime} from './memory.mjs';
import {cleanImages} from './qq-media.mjs';
const kinds=['characters','chats','memories'];
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,o[k]]));
function id(v){if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new Error('备份数据 ID 无效');return v;}
function text(v,max=1000000){if(typeof v!=='string'||v.length>max)throw new Error('备份文本格式或长度无效');return v;}
function records(rows,max=10000){if(!Array.isArray(rows)||rows.length>max)throw new Error('备份记录数量无效或过多');return rows;}
function memoryRecord(r){
  if(!r||typeof r.id!=='string'||!/^([a-f0-9-]{36}|[a-f0-9]{64})$/.test(r.id))throw new Error('记忆 ID 无效');
  text(r.text,100000);
  const out=pick(r,['id','text','source','sourceId','sourceScope','importance','category','revision','locallyEdited','importKey','mergedInto']);
  for(const k of ['sourceChatId','sourceMessageId'])if(r[k]!==undefined)out[k]=id(r[k]);
  if(r.selectionReason!==undefined)out.selectionReason=text(r.selectionReason,100);
  for(const k of ['source','sourceId','sourceScope','category','importKey','mergedInto'])if(k in out)text(out[k],1000);
  for(const k of ['importance','revision'])if(k in out&&(!Number.isFinite(out[k])||out[k]<0))throw new Error('记忆数值无效');
  for(const k of ['createdAt','updatedAt','validUntil','deletedAt'])if(r[k]!=null)out[k]=memoryTime(r[k]);
  if('locallyEdited' in out)out.locallyEdited=out.locallyEdited===true;
  if(r.mergedFrom)out.mergedFrom=records(r.mergedFrom).map(v=>({id:text(v.id,200),source:text(v.source||'',100),sourceId:v.sourceId==null?null:text(v.sourceId,1000)}));
  return out;
}
export function cleanSyncRecord(kind,value){const result=clean(kind,value),rows=kind==='chats'?result.messages:kind==='memories'?result.records:null;if(rows&&new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('同步记录含重复身份');return result;}
function clean(kind,value){
  const base={id:id(value.id)};
  if(kind==='characters')return {...character(value,{id:base.id}),createdAt:memoryTime(value.createdAt),updatedAt:memoryTime(value.updatedAt),...(value.deletedAt!==undefined?{deletedAt:memoryTime(value.deletedAt)}:{})};
  if(kind==='memories'){
    const out={...base,characterId:id(value.characterId||value.id),records:records(value.records).map(memoryRecord)};
    if(out.characterId!==out.id)throw new Error('记忆归属不一致');
    for(const k of ['sourceRoleId','sourceRoleName'])if(value[k]!=null)out[k]=text(value[k],1000);
    for(const k of ['exportedAt','updatedAt'])if(value[k]!=null)out[k]=memoryTime(value[k]);
    if(value.importKeys)out.importKeys=records(value.importKeys,50000).map(v=>text(v,1000));
    if(value.automaticEnabled!==undefined)out.automaticEnabled=value.automaticEnabled===true;
    if(value.retrievalEnabled!==undefined){if(typeof value.retrievalEnabled!=='boolean')throw Error('检索开关无效');out.retrievalEnabled=value.retrievalEnabled;}
    return out;
  }
  const out={...base,schemaVersion:1,characterId:id(value.characterId),characterName:text(value.characterName,100),title:text(value.title,100),createdAt:memoryTime(value.createdAt),updatedAt:memoryTime(value.updatedAt)};
  if(value.entry!==undefined){if(!['web','dsh','qq','phone'].includes(value.entry))throw Error('聊天入口无效');out.entry=value.entry;}
  if(value.kind!==undefined&&value.kind!=='group')throw Error('聊天类型无效');
  if(value.kind==='group'){
    const members=records(value.participants,8);if(members.length<2)throw Error('聊天室至少需要两个成员');
    out.kind='group';out.participants=members.map(p=>({characterId:id(p.characterId),name:text(p.name,100)}));
    if(new Set(out.participants.map(p=>p.characterId)).size!==members.length||!out.participants.some(p=>p.characterId===out.characterId))throw Error('聊天室成员身份无效');
  }
  out.messages=records(value.messages).map(m=>{
    if(!['user','assistant'].includes(m.role))throw new Error('消息角色无效');
    const row={id:id(m.id),role:m.role,content:text(m.content),createdAt:memoryTime(m.createdAt)};
    if(out.kind==='group'&&m.role==='assistant'){
      row.characterId=id(m.characterId);row.characterName=text(m.characterName,100);
      if(!out.participants.some(p=>p.characterId===row.characterId))throw Error('发言者不在聊天室中');
      if(m.turnUserMessageId)row.turnUserMessageId=id(m.turnUserMessageId);
    }
    if(m.images!==undefined)row.images=cleanImages(m.images);
    if(m.originalContent!==undefined)row.originalContent=text(m.originalContent,30000);
    if(m.favoriteAt!==undefined)row.favoriteAt=memoryTime(m.favoriteAt);
    if(m.finishReason){if(!['stop','length','cancelled','error','content_filter'].includes(m.finishReason))throw new Error('回复状态无效');row.finishReason=m.finishReason;}
    if(m.memoryTrace){const t=m.memoryTrace;row.memoryTrace={version:1,capturedAt:memoryTime(t.capturedAt),records:records(t.records).map(memoryRecord)};for(const k of ['expired','budgetSkipped','limit','used']){if(!Number.isSafeInteger(t[k])||t[k]<0)throw new Error('记忆追踪统计无效');row.memoryTrace[k]=t[k];}}
    if(m.memoryTrace?.selection){const t=m.memoryTrace;if(!['topic','fallback'].includes(t.selection)||!Number.isSafeInteger(t.unselected)||t.unselected<0)throw Error('检索追踪无效');Object.assign(row.memoryTrace,{selection:t.selection,unselected:t.unselected});}
    if(m.memoryTrace?.history){
      row.memoryTrace.history=records(m.memoryTrace.history,8).map(h=>{
        if(!['chat','memory'].includes(h.kind)||!Number.isFinite(h.score)||h.score<0||h.score>1.001)throw Error('历史检索记录无效');
        const item={id:text(h.id,200),kind:h.kind,title:text(h.title,1000),file:text(h.file,2000),text:text(h.text,10000),createdAt:memoryTime(h.createdAt),score:h.score,legacyArchive:h.legacyArchive===true,neighbors:records(h.neighbors||[],2).map(n=>{if(!['user','assistant'].includes(n.role))throw Error('邻近消息角色无效');return {id:id(n.id),role:n.role,content:text(n.content,2000),createdAt:memoryTime(n.createdAt)};})};
        if(h.speaker!==undefined){if(!['user','assistant','memory'].includes(h.speaker))throw Error('原文说话者无效');item.speaker=h.speaker;}
        if(h.chatId)item.chatId=id(h.chatId);if(h.messageId)item.messageId=id(h.messageId);if(h.recordId)item.recordId=text(h.recordId,200);return item;
      });
      row.memoryTrace.retrievalEngine=text(m.memoryTrace.retrievalEngine||'',100);row.memoryTrace.expanded=m.memoryTrace.expanded===true;
    }
    if(m.versions){
      if(m.role!=='assistant'||!Number.isInteger(m.activeVersion)||m.activeVersion<0||m.activeVersion>=m.versions.length)throw new Error('回复版本索引无效');
      row.versions=records(m.versions,50).map(v=>{if(v.versions)throw new Error('不允许嵌套回复版本');return clean('chats',{...out,messages:[{...v,role:'assistant'}]}).messages[0];});row.activeVersion=m.activeVersion;
      const selected=row.versions[row.activeVersion];if(selected.content!==row.content)throw new Error('当前回复与选中版本不一致');
    }
    return row;
  });
  if(new Set(out.messages.map(m=>m.id)).size!==out.messages.length)throw new Error('备份包含重复消息 ID');
  if(value.pendingTurn!==undefined){
    if(out.kind!=='group')throw Error('非聊天室不能包含群聊轮次');
    const t=value.pendingTurn,memberIds=out.participants.map(p=>p.characterId);
    const targets=records(t.characterIds,8).map(id),completed=records(t.completedIds,8).map(id);
    if(!targets.length||new Set(targets).size!==targets.length||new Set(completed).size!==completed.length||targets.some(v=>!memberIds.includes(v))||completed.some(v=>!targets.includes(v)))throw Error('聊天室待回复成员无效');
    const userMessageId=id(t.userMessageId);if(out.messages.findLast(m=>m.role==='user')?.id!==userMessageId)throw Error('聊天室待回复消息无效');
    out.pendingTurn={userMessageId,characterIds:targets,completedIds:completed};
    if(t.partialMessageId){const partial=out.messages.find(m=>m.id===id(t.partialMessageId));if(!partial||partial.role!=='assistant'||!['error','cancelled'].includes(partial.finishReason)||partial.turnUserMessageId!==userMessageId||!targets.includes(partial.characterId)||completed.includes(partial.characterId))throw Error('聊天室部分回复无效');out.pendingTurn.partialMessageId=partial.id;}
  }
  if(value.parentChatId)out.parentChatId=id(value.parentChatId);
  if(value.toolRuns)out.toolRuns=records(value.toolRuns,10000).map(r=>{if(!['running','completed','unknown'].includes(r.status))throw Error('工具状态无效');return {id:id(r.id),userMessageId:id(r.userMessageId),roleId:id(r.roleId),chatId:id(r.chatId),modelCallId:text(r.modelCallId,200),tool:text(r.tool,200),createdAt:memoryTime(r.createdAt),status:r.status,args:JSON.parse(text(JSON.stringify(r.args),100000)),...(r.result!==undefined?{result:text(r.result,20000)}:{})};});
  if(value.deletedAt!==undefined)out.deletedAt=memoryTime(value.deletedAt);
  if(value.parentMessageId)out.parentMessageId=id(value.parentMessageId);
  if(value.branchAction&&['edit','regenerate'].includes(value.branchAction))out.branchAction=value.branchAction;
  for(const k of ['pinned','archived','summaryEnabled'])if(value[k]!==undefined){if(typeof value[k]!=='boolean')throw new Error('聊天开关无效');out[k]=value[k];}
  if(value.importFingerprint)out.importFingerprint=text(value.importFingerprint,100);
  if(value.summary){const s=value.summary;if(!Number.isInteger(s.coveredCount)||s.coveredCount<1||s.coveredCount>out.messages.length||!/^[a-f0-9]{64}$/.test(s.fingerprint))throw new Error('摘要范围无效');out.summary={text:text(s.text,8000),coveredCount:s.coveredCount,fingerprint:s.fingerprint,updatedAt:memoryTime(s.updatedAt),edited:s.edited===true};}
  return out;
}
export function validateBackup(backup){
  if(backup?.format!=='muse-full-backup'||backup.schemaVersion!==1)throw new Error('请选择 Muse 完整备份 JSON');
  const result={format:backup.format,schemaVersion:1,exportedAt:memoryTime(backup.exportedAt)};
  for(const kind of kinds){const ids=new Set();result[kind]=records(backup[kind],10000).map(value=>{const row=clean(kind,value);if(ids.has(row.id))throw new Error('备份包含重复 ID');ids.add(row.id);return row;});}
  return result;
}
export async function exportFullBackup(store){
  const backup={format:'muse-full-backup',schemaVersion:1,exportedAt:Date.now()};for(const k of kinds)backup[k]=await store.list(k);return validateBackup(backup);
}
export async function previewFullBackup(store,input){
  const backup=validateBackup(input),counts={},pending=[];
  for(const kind of kinds){counts[kind]={total:backup[kind].length,added:0,skipped:0};for(const value of backup[kind]){if(await store.get(kind,value.id))counts[kind].skipped++;else{counts[kind].added++;pending.push({kind,value});}}}
  return {counts,pending,exportedAt:backup.exportedAt};
}
export async function restoreFullBackup(store,input){
  const plan=await previewFullBackup(store,input),created=[];
  try{for(const {kind,value} of plan.pending){const target=store.path(kind,value.id),temp=target+'.'+randomUUID()+'.tmp';
    try{await writeFile(temp,JSON.stringify(value),{flag:'wx'});await link(temp,target);created.push(target);}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }}catch(error){for(const target of created)await unlink(target);throw error;}
  return plan.counts;
}
