// SPDX-License-Identifier: GPL-3.0-or-later
import {createCipheriv,createDecipheriv,randomBytes,createHash,createHmac} from 'node:crypto';
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
export const proof=(key,text)=>createHmac('sha256',Buffer.from(key,'base64url')).update(text).digest('base64url');
export function seal(key,context,value){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'base64url'),nonce);cipher.setAAD(Buffer.from(context));return {nonce:nonce.toString('base64url'),data:Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]).toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};}
export function open(key,context,envelope){
 if(!envelope||typeof envelope.data!=='string'||envelope.data.length>24000000)throw Error('无效同步信封');
 const nonce=Buffer.from(envelope.nonce||'','base64url'),tag=Buffer.from(envelope.tag||'','base64url');if(nonce.length!==12||tag.length!==16)throw Error('无效同步信封');
 const cipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'base64url'),nonce);cipher.setAAD(Buffer.from(context));cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data,'base64url')),cipher.final()]).toString('utf8'));
}
export function mergeThree(base,local,remote,path=''){
 if(canonical(local)===canonical(remote)||canonical(base)===canonical(remote))return local;
 if(canonical(base)===canonical(local))return remote;
 if(path.endsWith('.updatedAt')&&Number.isFinite(local)&&Number.isFinite(remote))return Math.max(local,remote);
 if([base,local,remote].every(v=>Array.isArray(v))&&[base,local,remote].every(a=>a.every(v=>v&&typeof v.id==='string')&&new Set(a.map(v=>v.id)).size===a.length)){
  const maps=[base,local,remote].map(a=>new Map(a.map(v=>[v.id,v]))),ids=[...new Set([...base,...local,...remote].map(v=>v.id))];return ids.map(id=>mergeThree(...maps.map(m=>m.get(id)),path+'.'+id)).filter(v=>v!==undefined);
 }
 if([base,local,remote].every(v=>v&&typeof v==='object'&&!Array.isArray(v))){const out={};for(const k of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){const value=mergeThree(base[k],local[k],remote[k],path+'.'+k);if(value!==undefined)out[k]=value;}return out;}
 throw Error('同步冲突：'+path);
}
