// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
test('置顶、归档与恢复：版本校验、消息不变、重启持久化',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-organize-'));let server,base;
 async function start(){server=await createApp({dataDir:root});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(r=>server.close(r));
 const request=(p,method='GET',body)=>fetch(base+p,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...a)=>(await request(...a)).json();
 await start();try{
 const role=await json('characters','POST',{name:'测试',greeting:'保留消息'}),original=await json('chats','POST',{characterId:role.id}),path=`chats/${original.id}/organization`;
 let c=await json(path,'PUT',{updatedAt:original.updatedAt,pinned:true});assert.equal(c.pinned,true);
 assert.equal((await request(path,'PUT',{updatedAt:original.updatedAt,archived:true})).status,409);
 assert.equal((await request(path,'PUT',{updatedAt:c.updatedAt,archived:'true'})).status,400);
 c=await json(path,'PUT',{updatedAt:c.updatedAt,archived:true});assert.equal(c.archived,true);assert.deepEqual(c.messages,original.messages);
 await stop();await start();c=await json(`chats/${c.id}`);assert.equal(c.pinned,true);assert.equal(c.archived,true);
 assert.equal((await json('chats'))[0].archived,true);
 c=await json(path,'PUT',{updatedAt:c.updatedAt,archived:false,pinned:false});assert.equal(c.archived,false);assert.equal(c.pinned,false);assert.deepEqual(c.messages,original.messages);
 }finally{await stop();await rm(root,{recursive:true,force:true});}
});
