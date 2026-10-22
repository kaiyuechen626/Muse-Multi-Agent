// SPDX-License-Identifier: GPL-3.0-or-later
import {randomUUID} from 'node:crypto';

// Reserve before the first read, not after inference begins. A role is shared;
// a conversation is the unit of mutable state and cancellation.
export class TaskIsolation {
  constructor(){this.active=new Map();}
  has(chatId){return this.active.has(chatId);}
  get(chatId){return this.active.get(chatId);}
  acquire(chatId,entry,action){
    if(this.has(chatId))throw Object.assign(new Error('该会话正在处理任务，请稍后重试；其他会话可以同时使用'),{status:409});
    const task=Object.freeze({id:randomUUID(),chatId,entry,action,startedAt:Date.now()});
    this.active.set(chatId,task);return task;
  }
  release(task){if(this.active.get(task.chatId)===task)this.active.delete(task.chatId);}
  list(){return [...this.active.values()];}
}

export function requestTask(path,method,body,nativeChatId,entry='web'){
  if(method==='GET'||method==='HEAD')return null;
  const chat=path.match(/^\/api\/chats\/([a-f0-9-]{36})(?:\/([^/]+))?$/);
  if(chat&&chat[2]!=='stop')return {chatId:chat[1],entry,action:chat[2]||method.toLowerCase()};
  const native=path.match(/^\/api\/dsh\/native\/(bind|context|sync)$/);
  if(native)return {chatId:nativeChatId(body.sessionId),entry:'dsh',action:native[1]};
  return null;
}
