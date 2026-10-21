// SPDX-License-Identifier: GPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { memoryTime } from './memory.mjs';
export const normalizedMemory=text=>text.normalize('NFKC').toLowerCase().replace(/\s+/gu,'').replace(/[，,；;。！？!?]+$/gu,'');
function conflictReason(a,b){
  const positive=s=>s.replace(/(?:从来不|从不|并不|不再|不|没有|没)(?=喜欢|爱|喝|吃|住|是|想|用|养|接受|需要)/gu,'');
  if(a!==b&&positive(a)===positive(b)&&positive(a).length>=4)return '同一表述的否定词不同';
  if(a!==b&&/\d/.test(a)&&/\d/.test(b)&&a.replace(/\d+(?:\.\d+)?/g,'#')===b.replace(/\d+(?:\.\d+)?/g,'#'))return '同一表述中的数字不同';
  return '';
}
export function reviewMemories(memory){
  const all=(memory?.records||[]).filter(r=>!r.deletedAt),rows=all.slice(-500).map(r=>{
    const full=normalizedMemory(r.text),text=full.slice(0,2000),grams=new Set();for(let i=0;i<text.length-1;i++)grams.add(text.slice(i,i+2));return {r,full,text,grams};
  }),pairs=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=rows[i],b=rows[j],exact=a.full===b.full;
    let common=0;for(const g of a.grams)if(b.grams.has(g))common++;
    const score=exact?1:2*common/(a.grams.size+b.grams.size||1);
    const reason=conflictReason(a.full,b.full);
    if(exact||reason||(Math.min(a.text.length,b.text.length)>=8&&score>=.72))pairs.push({left:a.r,right:b.r,score,exact,kind:reason?'conflict':exact?'duplicate':'similar',reason});
  }
  pairs.sort((a,b)=>Number(b.kind==='conflict')-Number(a.kind==='conflict')||b.score-a.score);
  return {pairs:pairs.slice(0,50),totalPairs:pairs.length,scanned:rows.length,total:all.length};
}
export function mergeReviewedMemories(memory,input){
  if(!Array.isArray(input.records)||input.records.length!==2||input.records[0].id===input.records[1].id)throw new Error('请选择两条不同的记忆');
  if(typeof input.text!=='string'||!input.text.trim()||input.text.length>100000)throw new Error('合并内容须为 1–100000 字');
  const originals=input.records.map(ref=>{
    const r=memory.records.find(r=>r.id===ref.id&&!r.deletedAt);
    if(!r||(r.revision||0)!==ref.revision)throw new Error('记忆已变化，请重新检查后合并');return r;
  });
  if(input.keepId!==undefined&&!originals.some(r=>r.id===input.keepId))throw new Error('所选记忆不在本次检查中');
  const kept=originals.find(r=>r.id===input.keepId);
  if(kept&&input.text.trim()!==kept.text.trim())throw new Error('采用原记忆时内容必须一致');
  const next=structuredClone(memory),now=Date.now(),id=randomUUID();
  const expiry=(kept?[kept]:originals).map(r=>memoryTime(r.validUntil)).filter(t=>t!==null);
  const merged={id,text:input.text.trim(),source:'local',createdAt:now,updatedAt:now,revision:1,locallyEdited:true,importance:Math.max(...originals.map(r=>Number(r.importance)||0)),validUntil:expiry.length?Math.min(...expiry):null,mergedFrom:originals.map(r=>({id:r.id,source:r.source||'phone',sourceId:r.sourceId??null}))};
  for(const r of next.records)if(originals.some(o=>o.id===r.id)){r.deletedAt=now;r.updatedAt=now;r.revision=(r.revision||0)+1;r.mergedInto=id;}
  next.records.push(merged);next.updatedAt=now;return next;
}
