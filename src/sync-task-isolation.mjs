// SPDX-License-Identifier: GPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {digest} from './lan-sync-codec.mjs';

const transcript=chat=>chat?.messages?.map(({id,role,content,finishReason,images})=>({id,role,content,finishReason,images}));
// Concurrent continuations have different contexts. Keep each complete branch,
// rather than appending two unrelated turns to a single running conversation.
export function needsTaskFork(base,local,incoming,external=false){
  if(!local||!incoming||incoming.deletedAt||local.deletedAt)return false;
  // A group room is explicitly a shared public conversation. Its speaker-aware
  // merge protocol remains responsible for concurrent member contributions.
  if(local.kind==='group'||incoming.kind==='group')return false;
  const a=digest(transcript(local)),b=digest(transcript(incoming));
  if(a===b)return false;
  if(external)return true;
  if(!base)return false;
  const start=digest(transcript(base));
  return a!==start&&b!==start;
}
export function phoneTaskFork(incoming,id=randomUUID()){
  const now=Date.now();
  const fork={...structuredClone(incoming),id,entry:'phone',parentChatId:incoming.id,title:(incoming.title||'聊天').slice(0,82)+' · 手机独立任务',createdAt:now,updatedAt:now};
  delete fork.dshNative;delete fork.toolRuns;delete fork.importFingerprint;delete fork.summary;
  // Android message IDs are database-wide primary keys. A branch needs its own
  // IDs, including the copied prefix, or it would move messages out of its parent.
  const messageId=old=>{const h=createHash('sha256').update(id+':'+old).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;};
  const remap=m=>{m.id=messageId(m.id);delete m.dshSource;if(m.turnUserMessageId)m.turnUserMessageId=messageId(m.turnUserMessageId);for(const v of m.versions||[])remap(v);};
  for(const m of fork.messages)remap(m);
  if(fork.pendingTurn){fork.pendingTurn.userMessageId=messageId(fork.pendingTurn.userMessageId);if(fork.pendingTurn.partialMessageId)fork.pendingTurn.partialMessageId=messageId(fork.pendingTurn.partialMessageId);}
  return fork;
}
export function preserveLocalRouting(incoming,existing){
  if(!existing)return incoming;
  if(existing.entry)incoming.entry=existing.entry;
  if(existing.dshNative){
    incoming.dshNative=structuredClone(existing.dshNative);
    for(const message of incoming.messages){const old=existing.messages.find(m=>m.id===message.id);if(old?.dshSource)message.dshSource=structuredClone(old.dshSource);}
  }
  return incoming;
}
