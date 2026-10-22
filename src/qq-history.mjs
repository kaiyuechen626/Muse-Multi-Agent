// SPDX-License-Identifier: GPL-3.0-or-later
import {qqContent} from './qq-media.mjs';
export function qqText(message){
 if(!Array.isArray(message)||!message.length||message.some(s=>s.type!=='text'||typeof s.data?.text!=='string'))return '';
 const text=message.map(s=>s.data.text).join('').trim();return text.length<=30000?text:'';
}
export function qqKey(selfId,peerId,messageId){return `${selfId}:${peerId}:${messageId}`;}
export async function readQQHistory({call,selfId,peerId,since,now,maxPages=40,ignoredOutgoingIds=[]}){
 const rows=new Map();let cursor='0',previousOldest=Infinity,complete=false;
 for(let page=0;page<maxPages;page++){
  const data=await call('get_friend_msg_history',{user_id:peerId,message_seq:cursor,count:50,reverse_order:page>0,disable_get_url:true,parse_mult_msg:false});
  if(!Array.isArray(data?.messages)||data.messages.length>500)throw Error('QQ 历史记录格式无效');
  if(!data.messages.length){complete=true;break;}
  const batch=[];
  for(const m of data.messages){
   const sender=String(m.user_id??m.sender?.user_id??''),id=String(m.message_id??''),time=m.time*1000;
   if(m.message_type!=='private'||m.sub_type&&m.sub_type!=='friend'||m.self_id!==undefined&&String(m.self_id)!==selfId||![selfId,peerId].includes(sender)||!/^\-?\d{1,24}$/.test(id)||!Number.isSafeInteger(time)||time<=0||time>now+300000)continue;
   const parsed=qqContent(m.message);
   const row={id,key:qqKey(selfId,peerId,id),sender,time,text:parsed?.text||'',images:parsed?.images||[],seq:/^\d+$/.test(String(m.real_seq??''))?BigInt(m.real_seq):null};
   batch.push(row);rows.set(row.key,row);
  }
  if(!batch.length)throw Error('QQ 历史记录缺少可校验的消息身份');
  batch.sort(compare);const oldest=batch[0];
  if(oldest.time<since||data.messages.length<50){complete=true;break;}
  if(oldest.time>previousOldest||cursor===oldest.id)throw Error('QQ 历史分页没有向更早消息推进，补回已暂停');
  previousOldest=oldest.time;cursor=oldest.id;
 }
 if(!complete)throw Error('待检查的 QQ 历史超过 2000 条，补回已暂停；请先核对历史范围');
 const sorted=[...rows.values()].sort(compare),ignored=new Set(ignoredOutgoingIds),lastOutgoing=sorted.findLastIndex(r=>r.sender===selfId&&!ignored.has(r.id));
 return {incoming:sorted.filter((r,i)=>i>lastOutgoing&&r.sender===peerId&&r.time>=since&&r.text),answeredKeys:sorted.filter((r,i)=>i<=lastOutgoing&&r.sender===peerId&&r.time>=since).map(r=>r.key),latestTime:Math.max(since,...sorted.map(r=>r.time)),scanned:sorted.length};
}
function compare(a,b){if(a.time!==b.time)return a.time-b.time;if(a.seq!==null&&b.seq!==null&&a.seq!==b.seq)return a.seq<b.seq?-1:1;return 0;}
