// SPDX-License-Identifier: GPL-3.0-or-later
const stop=new Set(['用户','喜欢','什么','怎么','可以','我们','你们','他们','这个','那个','一下','今天','现在','the','and','you','what','that','this','with','for']);
export function terms(text){
  const result=new Set();let clean=text.normalize('NFKC').toLowerCase();
  for(const word of stop)if(/[\p{Script=Han}]/u.test(word))clean=clean.split(word).join(' ');
  for(const word of clean.match(/[a-z0-9]+|[\p{Script=Han}]+/gu)||[]){
    if(/^[a-z0-9]+$/.test(word)){if(word.length>1&&!stop.has(word))result.add(word);continue;}
    for(let i=0;i<word.length-1;i++){const pair=word.slice(i,i+2);if(!stop.has(pair))result.add(pair);}
    for(const c of word)if(!'的了是在我你他她它们有没不想要能会吗呢呀啊好请说和与也就都很这那什怎可今现'.includes(c))result.add(c);
  }
  return result;
}
export function rankMemories(records,query){
  const keys=terms(query.slice(-3000)),rows=records.map((record,index)=>({record,index,tokens:terms(record.text.slice(0,6000))}));
  const counts=new Map();for(const row of rows)for(const key of keys)if(row.tokens.has(key))counts.set(key,(counts.get(key)||0)+1);
  for(const row of rows){row.score=0;for(const key of keys)if(row.tokens.has(key))row.score+=(key.length===1?.25:1)*(1+Math.log((rows.length+1)/((counts.get(key)||0)+1)));}
  const importance=r=>Number(r.record.importance)||0;
  const ranked=rows.filter(r=>r.score>0).sort((a,b)=>b.score-a.score||importance(b)-importance(a)||a.index-b.index);
  const chosen=ranked.slice(0,12),ids=new Set(chosen.map(r=>r.record.id));
  const fallback=rows.filter(r=>!ids.has(r.record.id)).sort((a,b)=>importance(b)-importance(a)||a.index-b.index).slice(0,ranked.length?3:5);
  return {mode:ranked.length?'topic':'fallback',rows:[...chosen.map(r=>({...r.record,selectionReason:'话题匹配'})),...fallback.map(r=>({...r.record,selectionReason:'基础记忆补充'}))]};
}
