// SPDX-License-Identifier: GPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {cleanSyncRecord} from './full-backup.mjs';
import {hasParticipant,isGroupChat} from './group-chat.mjs';
import {digest} from './lan-sync-codec.mjs';
const name=v=>String(v||'').normalize('NFKC').trim().toLowerCase();
const fields=['systemPrompt','persona','scenario','greeting','examples','postHistory','avatar','background'];
const choiceKey=(a,b,n)=>[...([a,b].sort()),name(n)].join(':');
export function mergeIdentityRecords(primary=[],incoming=[],semantic=false){
 const out=structuredClone(primary),ids=new Map(out.map(r=>[r.id,r]));
 for(const raw of incoming){if(raw.deletedAt!=null)continue;const r=structuredClone(raw),same=ids.get(r.id);
  if(same&&digest(same)===digest(r))continue;
  if(semantic){const duplicate=out.find(x=>x.deletedAt==null&&x.text===r.text&&(x.category||'')===(r.category||''));if(duplicate){duplicate.importance=Math.max(duplicate.importance||0,r.importance||0);continue;}}
  if(same){r.id=randomUUID();if(semantic)r.mergedFrom=[...(r.mergedFrom||[]),{id:raw.id,source:'lan-identity-merge',sourceId:null}];}
  out.push(r);ids.set(r.id,r);
 }return out;
}
function settings(primary,incoming){const out={...primary};for(const k of fields)if(!out[k]&&incoming[k])out[k]=incoming[k];return out;}
export class IdentityMerges{
 constructor(sync){this.sync=sync;}
 get s(){return this.sync.state;}
 init(){for(const key of ['roleAliases','nameChoices','nameRequests','mergeJobs','identityConflicts'])this.s[key]??={};this.s.mergeVersion??=0;}
 canonical(id){const seen=new Set();while(this.s.roleAliases[id]){if(seen.has(id))throw Error('角色映射循环');seen.add(id);id=this.s.roleAliases[id];}return id;}
 pending(){return Object.values(this.s.nameRequests).map(r=>({id:r.id,name:r.name,sourceId:r.sourceId,targetId:r.targetId,deviceName:r.deviceName,sourcePreview:fields.slice(0,3).map(k=>r.sourceBody[k]||'').join('\n').slice(0,400),targetPreview:fields.slice(0,3).map(k=>r.targetBody[k]||'').join('\n').slice(0,400)}));}
 async discover(deviceId,input){
  const stored=new Map((await this.sync.store.list('characters')).filter(r=>r.deletedAt==null&&this.canonical(r.id)===r.id).map(r=>[r.id,r]));
  const incoming=new Map(input.changes.filter(c=>c.kind==='characters'&&c.body&&c.body.deletedAt==null&&this.canonical(c.id)===c.id).map(c=>[c.id,cleanSyncRecord('characters',c.body)]));
  const inventory=Array.isArray(input.roleInventory)?input.roleInventory:[...incoming.values()];if(inventory.length>10000)throw Error('角色目录过大');
  let dirty=false;
  for(const [id,r] of Object.entries(this.s.nameRequests)){
   const fresh=incoming.get(r.sourceId)||stored.get(r.sourceId),header=inventory.find(h=>h.id===r.sourceId);
   if(this.canonical(r.sourceId)!==r.sourceId||this.canonical(r.targetId)!==r.targetId||!stored.has(r.targetId)||name(stored.get(r.targetId).name)!==name(r.name)||(r.deviceId===deviceId&&(!header||name(header.name)!==name(r.name)))||(fresh&&name(fresh.name)!==name(r.name))){delete this.s.nameRequests[id];dirty=true;}
  }
  for(const header of inventory){const source=incoming.get(header.id)||stored.get(header.id);if(!source||source.deletedAt!=null)continue;
   for(const target of stored.values()){if(source.id===target.id||!name(source.name)||name(source.name)!==name(target.name))continue;
     const key=choiceKey(source.id,target.id,source.name);
     if(Object.values(this.s.devices).some(d=>d.groupMemberships?.some(ids=>ids.includes(source.id)&&ids.includes(target.id)))){
      if(this.s.nameChoices[key]!==false){this.s.nameChoices[key]=false;dirty=true;}for(const [id,r] of Object.entries(this.s.nameRequests))if(r.choiceKey===key){delete this.s.nameRequests[id];dirty=true;}continue;
     }
     if(Object.hasOwn(this.s.nameChoices,key))continue;
    const existing=Object.values(this.s.nameRequests).find(r=>r.choiceKey===key);
    if(existing){if(existing.sourceId===source.id&&digest(existing.sourceBody)!==digest(cleanSyncRecord('characters',source))){existing.sourceBody=cleanSyncRecord('characters',source);dirty=true;}continue;}
    const id=randomUUID();this.s.nameRequests[id]={id,choiceKey:key,name:target.name,sourceId:source.id,targetId:target.id,sourceBody:cleanSyncRecord('characters',source),targetBody:cleanSyncRecord('characters',target),deviceId,deviceName:this.s.devices[deviceId].name,createdAt:Date.now()};dirty=true;break;
   }
  }if(dirty)await this.sync.save();return this.pending();
 }
 rememberSettings(target,source,deviceName){
  if(!fields.some(k=>target[k]&&source[k]&&target[k]!==source[k]))return;
  const signature=digest({id:target.id,primary:fields.map(k=>target[k]||''),incoming:fields.map(k=>source[k]||'')});if(this.s.identityConflicts[signature])return;
  const id=randomUUID();this.s.identityConflicts[signature]=id;this.s.conflicts.push({id,kind:'characters',recordId:target.id,createdAt:Date.now(),deviceName,reason:'同名角色合并：不同设定保留副本',local:cleanSyncRecord('characters',target),incoming:cleanSyncRecord('characters',source)});
 }
 async decide(id,merge){
  if(typeof merge!=='boolean')throw Error('请选择合并或分别保留');const r=this.s.nameRequests[id];if(!r)return; // Cross-device answers and retries are idempotent.
  const target=await this.sync.store.get('characters',r.targetId),source=await this.sync.store.get('characters',r.sourceId)||r.sourceBody;
  if(!target||target.deletedAt!=null||name(target.name)!==name(source.name)||this.canonical(source.id)!==source.id||this.canonical(target.id)!==target.id)throw Error('角色已经变化，请刷新后重新选择');
  if(!merge){this.s.nameChoices[r.choiceKey]=false;delete this.s.nameRequests[id];await this.sync.save();return;}
    if(Object.values(this.s.devices).some(d=>d.groupMemberships?.some(ids=>ids.includes(source.id)&&ids.includes(target.id))))throw Error('这两个角色在手机的同一聊天室中，请选择分别保留');
  const writes=[],originals=[];const put=(kind,value)=>writes.push({kind,id:value.id,value});
  originals.push({kind:'characters',value:target},{kind:'characters',value:source});put('characters',settings(target,source));
  for(const chat of await this.sync.store.list('chats'))if(hasParticipant(chat,source.id)){
    if(isGroupChat(chat)&&hasParticipant(chat,target.id))throw Error('这两个角色已在同一电脑聊天室中，请选择分别保留，以保留发言身份');
    originals.push({kind:'chats',value:chat});const next=structuredClone(chat);
    if(next.characterId===source.id){next.characterId=target.id;next.characterName=target.name;}
    if(isGroupChat(next)){
      next.participants=next.participants.map(p=>p.characterId===source.id?{characterId:target.id,name:target.name}:p);
      for(const m of next.messages)if(m.characterId===source.id)m.characterId=target.id;
      if(next.pendingTurn)for(const k of ['characterIds','completedIds'])next.pendingTurn[k]=next.pendingTurn[k].map(id=>id===source.id?target.id:id);
      delete next.summary;next.updatedAt=Math.max(Date.now(),next.updatedAt+1);
    }
    put('chats',next);
  }
  const a=await this.sync.store.get('memories',target.id),b=await this.sync.store.get('memories',source.id);if(a||b){originals.push(...[a,b].filter(Boolean).map(value=>({kind:'memories',value})));put('memories',{...(a||b),id:target.id,characterId:target.id,records:mergeIdentityRecords(a?.records,b?.records,true)});}
  writes.push({kind:'memories',id:source.id,value:null},{kind:'characters',id:source.id,value:null});
  const plan={id:randomUUID(),request:r,writes,originals,target,source};const dir=join(this.sync.folder,'identity-merges');await mkdir(dir,{recursive:true});await writeFile(join(dir,plan.id+'.json'),JSON.stringify(plan),{flag:'wx',mode:0o600});
  this.s.mergeJobs[plan.id]={status:'pending'};await this.sync.save();await this.applyPlan(plan);
 }
 async applyPlan(plan){
  for(const w of plan.writes)if(w.value)await this.sync.store.put(w.kind,w.value);else if(await this.sync.store.get(w.kind,w.id))await this.sync.store.remove(w.kind,w.id);
  const r=plan.request;this.s.roleAliases[r.sourceId]=r.targetId;this.s.mergeVersion++;this.s.nameChoices[r.choiceKey]=true;delete this.s.nameRequests[r.id];this.s.mergeJobs[plan.id]={status:'complete'};
  this.rememberSettings(plan.target,plan.source,r.deviceName);
  for(const d of Object.values(this.s.devices)){const previous=d.mergeBootstrap;d.mergeBootstrap={version:this.s.mergeVersion,targets:[...new Set([...(previous?.targets||[]),r.targetId])].map(id=>this.canonical(id)),seeded:{}};}
  try{await this.sync.save();}catch(error){this.s.mergeJobs[plan.id]={status:'pending'};throw error;}
 }
 async recover(){for(const [id,job] of Object.entries(this.s.mergeJobs))if(job.status==='pending')await this.applyPlan(JSON.parse(await readFile(join(this.sync.folder,'identity-merges',id+'.json'),'utf8')));}
 directives(input,device){if((input.roleMergeVersion||0)>=this.s.mergeVersion)return null;const roleMerges=Object.keys(this.s.roleAliases).map(from=>({from,to:this.canonical(from)}));if(!device.mergeBootstrap||device.mergeBootstrap.version!==this.s.mergeVersion)device.mergeBootstrap={version:this.s.mergeVersion,targets:[...new Set(roleMerges.map(m=>m.to))],seeded:{}};else if(!input.roleMergeVersion)device.mergeBootstrap.targets=[...new Set([...device.mergeBootstrap.targets,...roleMerges.map(m=>m.to)])];return {roleMerges,roleMergeVersion:this.s.mergeVersion};}
 seed(device,input,change,old,body){
  const b=device.mergeBootstrap,key=change.kind+':'+change.id,roleId=change.kind==='chats'?body?.characterId:change.id;
  if(!b||input.identityMergeVersion!==b.version||b.seeded[key]||!b.targets.includes(roleId)||!body)return null;
  let merged=change.kind==='memories'?{...(old?.body||body),records:mergeIdentityRecords(old?.body?.records,body.records,true)}:body;if(old?.body){
   if(change.kind==='characters'){this.rememberSettings(old.body,body,device.name);merged=settings(old.body,body);}
   if(change.kind==='memories')merged={...old.body,records:mergeIdentityRecords(old.body.records,body.records,true)};
   if(change.kind==='chats'){merged={...old.body,messages:mergeIdentityRecords(old.body.messages,body.messages).sort((a,b)=>a.createdAt-b.createdAt),updatedAt:Math.max(old.body.updatedAt,body.updatedAt)};delete merged.summary;}
  }return {body:merged,key};
 }
}
