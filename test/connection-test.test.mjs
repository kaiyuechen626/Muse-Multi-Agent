// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
test('连接测试使用已保存密钥，不写聊天，错误不回显密钥',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-connection-'));let fail=false;
 const server=await createApp({dataDir:root,provider:async(role,history,key)=>{assert.equal(role.model,'deepseek-chat');assert.equal(key,'test-key');if(fail)throw new Error('DeepSeek 余额不足');return {content:'OK',finishReason:'stop'};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/`;
 const req=(path,method='GET',body)=>fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 try{await req('settings','DELETE');assert.equal((await req('settings/test','POST',{})).status,400);await req('settings','PUT',{apiKey:'test-key'});
 const result=await (await req('settings/test','POST',{})).json();assert.equal(result.ok,true);assert.ok(!JSON.stringify(result).includes('test-key'));assert.deepEqual(await (await req('chats')).json(),[]);
 fail=true;assert.equal((await (await req('settings/test','POST',{})).json()).error,'DeepSeek 余额不足');
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
