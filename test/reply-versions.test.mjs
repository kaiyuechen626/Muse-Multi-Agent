// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
test('同会话回复版本、上下文、失败保留、历史锁定与完整备份',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-versions-'));let server,base,n=0,fail=false,partial=false,seen;
 async function start(){server=await createApp({dataDir:root,provider:async(_r,history,_key,{onDelta})=>{seen=structuredClone(history);if(partial){onDelta?.('部分回复');throw new Error('断线');}if(fail)throw new Error('失败');return {content:`回答${++n}`,finishReason:'stop'};}});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(r=>server.close(r));const req=(p,method='GET',body)=>fetch(base+p,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const json=async(...a)=>(await req(...a)).json();
 await start();try{
 await json('settings','PUT',{apiKey:'test'});const role=await json('characters','POST',{name:'测试'});let c=await json('chats','POST',{characterId:role.id});const path=`chats/${c.id}`;
 c=await json(path+'/messages','POST',{content:'你好'});const messageId=c.messages.at(-1).id;
 c=await json(path+'/messages','POST',{regenerate:true,messageId,updatedAt:c.updatedAt});assert.equal(c.messages.length,2);assert.equal(c.messages[1].versions.length,2);assert.equal(c.messages[1].activeVersion,1);assert.equal(seen.length,1);assert.equal((await json('chats')).length,1);
 c=await json(path+'/version','PUT',{messageId,index:0,updatedAt:c.updatedAt});assert.equal(c.messages[1].content,'回答1');
 const backup=await json('backup');assert.equal(backup.chats[0].messages[1].versions.length,2);
 fail=true;await req(path+'/messages','POST',{regenerate:true,messageId,updatedAt:c.updatedAt});c=await json(path);assert.equal(c.messages[1].content,'回答1');assert.equal(c.messages[1].versions.length,2);fail=false;
 partial=true;const stream=await req(path+'/messages','POST',{regenerate:true,messageId,updatedAt:c.updatedAt,stream:true});await stream.text();c=await json(path);assert.equal(c.messages[1].versions.length,3);assert.equal(c.messages[1].finishReason,'error');partial=false;
 c=await json(path+'/version','PUT',{messageId,index:0,updatedAt:c.updatedAt});await stop();await start();c=await json(path);assert.equal(c.messages[1].content,'回答1');assert.equal(c.messages[1].versions.length,3);
 await json('settings','PUT',{apiKey:'test'});c=await json(path+'/messages','POST',{content:'继续'});assert.equal(seen[1].content,'回答1');
 assert.equal((await req(path+'/version','PUT',{messageId,index:1,updatedAt:c.updatedAt})).status,400);
 }finally{await stop();await rm(root,{recursive:true,force:true});}
});
