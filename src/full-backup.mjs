// SPDX-License-Identifier: GPL-3.0-or-later
import {writeFile,link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {character} from './characters.mjs';
import {memoryTime} from './memory.mjs';
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
  out.messages=records(value.messages).map(m=>{
    if(!['user','assistant'].includes(m.role))throw new Error('消息角色无效');
    const row={id:id(m.id),role:m.role,content:text(m.content),createdAt:memoryTime(m.createdAt)};
    if(m.favoriteAt!==undefined)row.favoriteAt=memoryTime(m.favoriteAt);
    if(m.finishReason){if(!['stop','length','cancelled','error','content_filter'].includes(m.finishReason))throw new Error('回复状态无效');row.finishReason=m.finishReason;}
    if(m.memoryTrace){const t=m.memoryTrace;row.memoryTrace={version:1,capturedAt:memoryTime(t.capturedAt),records:records(t.records).map(memoryRecord)};for(const k of ['expired','budgetSkipped','limit','used']){if(!Number.isSafeInteger(t[k])||t[k]<0)throw new Error('记忆追踪统计无效');row.memoryTrace[k]=t[k];}}
    if(m.memoryTrace?.selection){const t=m.memoryTrace;if(!['topic','fallback'].includes(t.selection)||!Number.isSafeInteger(t.unselected)||t.unselected<0)throw Error('检索追踪无效');Object.assign(row.memoryTrace,{selection:t.selection,unselected:t.unselected});}
    if(m.versions){
      if(m.role!=='assistant'||!Number.isInteger(m.activeVersion)||m.activeVersion<0||m.activeVersion>=m.versions.length)throw new Error('回复版本索引无效');
      row.versions=records(m.versions,50).map(v=>{if(v.versions)throw new Error('不允许嵌套回复版本');return clean('chats',{...out,messages:[{...v,role:'assistant'}]}).messages[0];});row.activeVersion=m.activeVersion;
      const selected=row.versions[row.activeVersion];if(selected.content!==row.content)throw new Error('当前回复与选中版本不一致');
    }
    return row;
  });
  if(new Set(out.messages.map(m=>m.id)).size!==out.messages.length)throw new Error('备份包含重复消息 ID');
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
