// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash, randomUUID } from 'node:crypto';
export function importChat(data,character){
  if(!data||data.schemaVersion!==1||!Array.isArray(data.messages))throw new Error('请选择 Muse 导出的 JSON 聊天备份');
  if(typeof data.title!=='string'||!data.title.trim()||data.title.length>100)throw new Error('备份中的聊天名称无效');
  if(data.messages.length>10000)throw new Error('单份备份最多支持 10000 条消息');
  const time=value=>{if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)throw new Error('备份中的时间无效');return value;};
  const messages=data.messages.map(m=>{
    if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>1000000)throw new Error('备份包含无效消息，仅支持用户和角色消息');
    if(m.finishReason!==undefined&&!['stop','length','cancelled','error','content_filter'].includes(m.finishReason))throw new Error('备份中的回复状态无效');
    return {role:m.role,content:m.content,createdAt:time(m.createdAt),...(m.favoriteAt!==undefined?{favoriteAt:time(m.favoriteAt)}:{}),...(m.finishReason?{finishReason:m.finishReason}:{})};
  });
  const clean={title:data.title.trim(),createdAt:time(data.createdAt),updatedAt:time(data.updatedAt),messages};
  const importFingerprint=createHash('sha256').update(JSON.stringify(clean)).digest('hex');
  return {schemaVersion:1,...clean,id:randomUUID(),characterId:character.id,characterName:character.name,importFingerprint,messages:messages.map(m=>({...m,id:randomUUID()}))};
}
export function chatSummary(chat,query=''){
  const q=query.trim().toLocaleLowerCase();
  const matching=q?chat.messages.find(m=>m.content.toLocaleLowerCase().includes(q)):null;
  if(q&&!`${chat.title} ${chat.characterName}`.toLocaleLowerCase().includes(q)&&!matching)return null;
  const {messages,toolRuns,...summary}=chat;
  let excerpt='';
  if(matching){const start=Math.max(0,matching.content.toLocaleLowerCase().indexOf(q)-25);excerpt=(start?'…':'')+matching.content.slice(start,start+110);}
  return {...summary,messageCount:messages.length,excerpt};
}
export function exportChat(chat,format){
  const clean={schemaVersion:1,id:chat.id,characterId:chat.characterId,characterName:chat.characterName,title:chat.title,createdAt:chat.createdAt,updatedAt:chat.updatedAt,messages:chat.messages.map(({id,role,content,createdAt,finishReason,favoriteAt})=>({id,role,content,createdAt,...(favoriteAt?{favoriteAt}:{}),...(finishReason?{finishReason}:{})}))};
  if(format==='json')return JSON.stringify(clean,null,2);
  if(format!=='md')throw new Error('导出格式必须为 JSON 或 Markdown');
  const safe=s=>String(s).replace(/[<>#*_[\]`\\]/g,c=>'\\'+c).replace(/[\r\n]+/g,' ');
  const parts=[`# ${safe(clean.title)}`,`角色：${safe(clean.characterName)}`,`创建时间：${new Date(clean.createdAt).toISOString()}`];
  for(const m of clean.messages){
    const fence='`'.repeat(Math.max(3,...Array.from(m.content.matchAll(/`+/g),x=>x[0].length+1)));
    parts.push(`## ${m.role==='user'?'用户':safe(clean.characterName)}${m.finishReason&&m.finishReason!=='stop'?`（${safe(m.finishReason)}）`:''}`,`${fence}text\n${m.content}\n${fence}`);
  }
  return parts.join('\n\n')+'\n';
}
