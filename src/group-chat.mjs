// SPDX-License-Identifier: GPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {memoryContextSnapshot} from './memory.mjs';
import {generateSummary,needsSummary,summaryHistory} from './chat-summary.mjs';

export const isGroupChat=chat=>chat?.kind==='group';
export const hasParticipant=(chat,id)=>isGroupChat(chat)?chat.participants.some(p=>p.characterId===id):chat?.characterId===id;
export const speakerName=(chat,message)=>message.role==='user'?'用户':message.characterName||chat.participants?.find(p=>p.characterId===message.characterId)?.name||chat.characterName;

export async function createGroupChat(body,activeRole){
  if(!Array.isArray(body.characterIds)||body.characterIds.length<2||body.characterIds.length>8||new Set(body.characterIds).size!==body.characterIds.length)throw Error('聊天室请选择 2–8 个不同角色');
  const roles=[];
  for(const id of body.characterIds){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('角色标识无效');const role=await activeRole(id);if(!role)throw Error('所选角色已不可用，请重新选择');roles.push(role);}
  if(body.title!==undefined&&(typeof body.title!=='string'||!body.title.trim()||body.title.length>100))throw Error('聊天室名称须为 1–100 字');
  const now=Date.now();
  return {schemaVersion:1,kind:'group',id:randomUUID(),characterId:roles[0].id,characterName:roles[0].name,participants:roles.map(r=>({characterId:r.id,name:r.name})),title:body.title?.trim()||`${roles.map(r=>r.name).join('、')}的聊天室`.slice(0,100),createdAt:now,updatedAt:now,messages:[]};
}

// Only this speaker's messages are assistant turns. Other speakers are labelled
// conversation data, never another character's persona or private memory.
export function groupHistory(chat,roleId,history=chat.messages){
  return history.map(m=>({id:m.id,role:m.role==='system'?'system':m.role==='assistant'&&m.characterId===roleId?'assistant':'user',content:m.role==='system'||m.role==='assistant'&&m.characterId===roleId?m.content:JSON.stringify({speaker:speakerName(chat,m),speakerId:m.role==='user'?'user':m.characterId,text:m.content})}));
}
const memoryHistory=messages=>messages.map(({id,role,content,originalContent,characterId,characterName,createdAt})=>({id,role,content,originalContent,characterId,characterName,createdAt}));
export function groupRole(role,chat){
  return {...role,postHistory:[role.postHistory,`这是多人聊天室。你只扮演 ${role.name}（身份 ID：${role.id}）。成员：${JSON.stringify(chat.participants)}。每条历史消息的 speaker 和 speakerId 标明实际发言者；其他 AI 的话不是用户本人的陈述。保持你自己的性格、立场和记忆，可以回应其他成员，但只写你本人的一条回复，不代写他人发言，不伪称拥有别人的私人记忆。发言者标签由界面添加。`].filter(Boolean).join('\n\n')};
}

export async function runGroupTurn({chat,body,store,activeRole,provider,library,key,busy,remember,res,json,task}){
  if(!key)return json(400,{error:'请先配置 DeepSeek API Key'});
  if(body.regenerate)throw Error('聊天室请使用消息编辑分支，或指定角色发送新的消息');
  const retry=body.retry===true;
  if(retry&&!chat.pendingTurn)throw Error('没有待继续的聊天室回复');
  if(!retry&&(typeof body.content!=='string'||!body.content.trim()||body.content.length>30000))throw Error('消息须为 1–30000 字');
  const ids=retry?chat.pendingTurn.characterIds:body.replyCharacterId?[body.replyCharacterId]:chat.participants.map(p=>p.characterId);
  if(ids.some(id=>!hasParticipant(chat,id)))throw Error('指定角色不在聊天室中');
  const completed=retry?chat.pendingTurn.completedIds:[];
  const speakers=[];
  for(const id of ids.filter(id=>!completed.includes(id))){const role=await activeRole(id);if(!role)return json(409,{error:'本轮成员中有已删除角色，请恢复该角色或指定其他成员发言'});speakers.push(role);}
  // Re-check after asynchronous reads so concurrent requests cannot start two rounds.
  if(busy.has(chat.id))return json(409,{error:'该会话正在生成回复'});
  const controller=new AbortController();busy.set(chat.id,controller);
  const streaming=body.stream===true,event=value=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(value)+'\n');};
  const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
  let heartbeat,partial='',currentRole=null,memoryTrace;
  const save=async()=>{chat.updatedAt=Math.max(Date.now(),chat.updatedAt+1);await store.put('chats',chat);};
  try{
    if(!retry){
      const user={id:randomUUID(),role:'user',content:body.content.trim(),createdAt:Date.now()};chat.messages.push(user);
      chat.pendingTurn={userMessageId:user.id,characterIds:ids,completedIds:[]};
    }else if(chat.pendingTurn.partialMessageId){
      chat.messages=chat.messages.filter(m=>m.id!==chat.pendingTurn.partialMessageId);delete chat.pendingTurn.partialMessageId;
    }
    delete chat.error;await save();
    if(streaming){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});event({type:'start',chat,task});heartbeat=setInterval(()=>event({type:'ping'}),15000);}
    for(const role of speakers){
      controller.signal.throwIfAborted();currentRole=role;partial='';memoryTrace=undefined;
      if(streaming)event({type:'speaker',characterId:role.id,characterName:role.name});
      let history;
      try{if(needsSummary(chat))chat.summary=await generateSummary(chat,key,provider,controller.signal);history=summaryHistory(chat);}
      catch(e){if(controller.signal.aborted)throw e;history=chat.messages;chat.summaryError='摘要生成失败，本轮使用完整聊天原文。';}
      const memory=await store.get('memories',role.id);
      const snapshot=await library.context(role,memory,chat.messages,memoryContextSnapshot(memory,24000,Date.now(),chat.messages.findLast(m=>m.role==='user')?.content||''),{signal:controller.signal,chatId:chat.id});memoryTrace=snapshot.trace;
      controller.signal.throwIfAborted();
      const answer=await provider({...groupRole(role,chat),memoryContext:snapshot.prompt},groupHistory(chat,role.id,history),key,{signal:controller.signal,onDelta:streaming?delta=>{partial+=delta;event({type:'delta',characterId:role.id,content:delta});}:undefined});
      controller.signal.throwIfAborted();
      const message={id:randomUUID(),role:'assistant',characterId:role.id,characterName:role.name,turnUserMessageId:chat.pendingTurn.userMessageId,...answer,createdAt:Date.now(),memoryTrace};
      chat.messages.push(message);chat.pendingTurn.completedIds.push(role.id);partial='';await save();
      if(answer.finishReason==='stop')remember(role.id,chat.id,memoryHistory(chat.messages));
      if(streaming)event({type:'reply',chat,message});
    }
    delete chat.pendingTurn;delete chat.error;await save();
    if(streaming){event({type:'done',chat});return res.end();}return json(200,chat);
  }catch(e){
    const stopped=controller.signal.aborted;chat.error=stopped?'已停止生成，可继续未完成的回复':`${currentRole?.name||'聊天室'}：${e.message}`;
    if(partial&&currentRole){const message={id:randomUUID(),role:'assistant',characterId:currentRole.id,characterName:currentRole.name,turnUserMessageId:chat.pendingTurn.userMessageId,content:partial,finishReason:stopped?'cancelled':'error',createdAt:Date.now(),memoryTrace};chat.messages.push(message);chat.pendingTurn.partialMessageId=message.id;}
    await save();if(streaming&&res.headersSent){event({type:'error',error:chat.error,chat});return res.end();}return json(502,{error:chat.error});
  }finally{clearInterval(heartbeat);res.off('close',disconnect);busy.delete(chat.id);}
}
