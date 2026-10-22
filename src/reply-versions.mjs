// SPDX-License-Identifier: GPL-3.0-or-later
import {randomUUID} from 'node:crypto';
export function replySnapshot(message){return Object.fromEntries(['content','createdAt','finishReason','memoryTrace','images'].filter(k=>message[k]!==undefined).map(k=>[k,structuredClone(message[k])]));}
export function addReplyVersion(original,answer){
  const versions=original.versions?structuredClone(original.versions):[{id:randomUUID(),...replySnapshot(original)}];
  if(versions.length>=50)throw new Error('本条回复已达到 50 个版本上限，请创建新分支');
  versions.push({id:randomUUID(),...replySnapshot(answer)});
  return {id:original.id,role:'assistant',...replySnapshot(answer),...(original.favoriteAt?{favoriteAt:original.favoriteAt}:{}),versions,activeVersion:versions.length-1};
}
export function selectReplyVersion(chat,messageId,index){
  const message=chat.messages.at(-1);
  if(message?.id!==messageId||message.role!=='assistant')throw new Error('只能切换最后一条回复；较早回复请使用分支');
  if(!Number.isInteger(index)||!message.versions?.[index])throw new Error('回复版本不存在');
  chat.messages[chat.messages.length-1]={id:message.id,role:'assistant',...replySnapshot(message.versions[index]),...(message.favoriteAt?{favoriteAt:message.favoriteAt}:{}),versions:message.versions,activeVersion:index};
  delete chat.error;chat.updatedAt=Math.max(Date.now(),chat.updatedAt+1);return chat;
}
