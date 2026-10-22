// SPDX-License-Identifier: GPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {promptMessages} from './characters.mjs';
import {memoryContextSnapshot} from './memory.mjs';

export function nativeChatId(sessionId) {
  if(typeof sessionId!=='string'||!sessionId.trim()||sessionId.length>200)throw Error('DSH 会话标识无效');
  const h=createHash('sha256').update('muse-dsh-native-v1:'+sessionId).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Native chats use the normal Store so memory mirrors and LAN sync see the same data.
export class NativeChats {
  constructor({store,library,busy,activeRole,remember}){Object.assign(this,{store,library,busy,activeRole,remember});}
  async read(sessionId){
    const chat=await this.store.get('chats',nativeChatId(sessionId));
    if(chat&&chat.dshNative?.sessionId!==sessionId)throw Error('DSH 绑定资料不完整，请恢复备份后重试');
    return chat;
  }
  async state(sessionId){
    const chat=await this.read(sessionId);
    const roles=(await this.store.list('characters')).filter(r=>!r.deletedAt).map(r=>({id:r.id,name:r.name}));
    return {roles,binding:chat?{roleId:chat.characterId,roleName:roles.find(r=>r.id===chat.characterId)?.name||chat.characterName,chatId:chat.id,unavailable:!!chat.deletedAt||!roles.some(r=>r.id===chat.characterId),throughSeq:chat.dshNative.throughSeq??-1}:null};
  }
  async locked(sessionId,fn){
    const id=nativeChatId(sessionId);
    if(this.busy.has(id))throw Error('Muse 正在保存此会话，请稍后重试');
    const controller=new AbortController();this.busy.set(id,controller);
    try{return await fn(controller.signal);}finally{this.busy.delete(id);}
  }
  async bind(sessionId,roleId){
    return this.locked(sessionId,async()=>{
      const role=await this.activeRole(roleId);if(!role)throw Error('所选 Muse 角色已不可用');
      let chat=await this.read(sessionId);
      if(chat){
        if(chat.characterId!==roleId)throw Error('此 DSH 会话已绑定其他角色，请新建会话');
        if(chat.deletedAt)throw Error('对应 Muse 聊天已删除，请先恢复');
      }else{
        const now=Date.now();chat={schemaVersion:1,entry:'dsh',id:nativeChatId(sessionId),characterId:role.id,characterName:role.name,title:`DSH · ${role.name}`.slice(0,100),createdAt:now,updatedAt:now,messages:[],dshNative:{sessionId,throughSeq:-1,rememberedTurn:0}};
        await this.store.put('chats',chat);
      }
      return this.state(sessionId);
    });
  }
  async requireChat(sessionId,roleId){
    const chat=await this.read(sessionId);
    if(!chat||chat.deletedAt||chat.characterId!==roleId)throw Error('DSH 角色绑定已失效，请检查 Muse 聊天');
    const role=await this.activeRole(roleId);if(!role)throw Error('绑定角色已删除，已停止载入记忆');
    return {chat,role};
  }
  async sync({sessionId,roleId,messages,throughSeq,completedTurn=0}){
    return this.locked(sessionId,async()=>{
      const {chat}=await this.requireChat(sessionId,roleId);
      if(!Array.isArray(messages)||messages.length>200||!Number.isSafeInteger(throughSeq)||throughSeq<0||!Number.isSafeInteger(completedTurn)||completedTurn<0)throw Error('DSH 回写批次无效');
      let changed=false,last=-1;
      // Validate the entire batch before touching the persisted transcript.
      const rows=messages.map(m=>{
        if(!m||!Number.isSafeInteger(m.seq)||m.seq<0||m.seq<=last||m.seq>throughSeq||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>300000||!Number.isSafeInteger(m.createdAt)||m.createdAt<0||m.finishReason!==undefined&&!['stop','cancelled','length','error'].includes(m.finishReason))throw Error('DSH 消息格式无效');
        last=m.seq;
        const sourceDigest=digest([m.role,m.content,m.createdAt,m.finishReason||'']);
        const old=chat.messages.find(x=>x.dshSource?.seq===m.seq);
        if(old&&old.dshSource.digest!==sourceDigest)throw Error('DSH 消息身份冲突，拒绝覆盖');
        if(old)return null;
        if(m.seq<=chat.dshNative.throughSeq)throw Error('DSH 回写游标之前出现未知消息');
        return {id:randomUUID(),role:m.role,content:m.content,createdAt:m.createdAt,...(m.role==='assistant'?{finishReason:m.finishReason||'stop'}:{}),dshSource:{seq:m.seq,digest:sourceDigest}};
      });
      for(const row of rows)if(row){chat.messages.push(row);changed=true;}
      if(throughSeq>chat.dshNative.throughSeq){chat.dshNative.throughSeq=throughSeq;changed=true;}
      const extract=completedTurn>chat.dshNative.rememberedTurn&&chat.messages.at(-1)?.role==='assistant'&&chat.messages.at(-1)?.finishReason==='stop';
      if(extract){chat.dshNative.rememberedTurn=completedTurn;changed=true;}
      if(changed){chat.updatedAt=Math.max(Date.now(),chat.updatedAt+1);await this.store.put('chats',chat);}
      if(extract)this.remember(roleId,chat.id,structuredClone(chat.messages));
      return {ok:true,chatId:chat.id,throughSeq:chat.dshNative.throughSeq};
    });
  }
  async context({sessionId,roleId,query}){
    return this.locked(sessionId,async signal=>{
      if(typeof query!=='string'||query.length>300000)throw Error('检索内容无效');
      const {chat,role}=await this.requireChat(sessionId,roleId);
      const memory=await this.store.get('memories',roleId);
      const history=[...chat.messages.slice(-20),{role:'user',content:query}];
      const snapshot=await this.library.context(role,memory,history,memoryContextSnapshot(memory,24000,Date.now(),query),{signal,chatId:chat.id});
      return {roleId,roleName:role.name,persona:promptMessages(role,[]).filter(m=>m.role==='system').map(m=>m.content).join('\n\n'),memory:snapshot.prompt,trace:snapshot.trace};
    });
  }
}
