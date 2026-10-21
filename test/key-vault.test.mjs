// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { KeyVault } from '../src/key-vault.mjs';
test('Windows DPAPI：密文落盘、重启恢复、不回显、取消记住及清除', {skip:process.platform!=='win32'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-vault-')),secret='test-only-not-a-real-key-123';let server,base;
 async function start(){server=await createApp({dataDir:root,provider:async(r,m,key)=>{assert.equal(key,secret);return {content:'ok',finishReason:'stop'};}});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/`;}
 const stop=()=>new Promise(r=>server.close(r));
 const request=(p,method='GET',body)=>fetch(base+p,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const json=async(...a)=>(await request(...a)).json();
 await start();try{
 const saved=await json('settings','PUT',{apiKey:secret,remember:true});assert.equal(saved.remembered,true);assert.ok(!JSON.stringify(saved).includes(secret));
 const vault=new KeyVault(root),cipher=await readFile(vault.path);assert.equal(cipher.includes(Buffer.from(secret)),false);assert.equal(await vault.load(),secret);
 await stop();await start();assert.equal((await json('settings')).remembered,true);
 const role=await json('characters','POST',{name:'测试'}),chat=await json('chats','POST',{characterId:role.id});assert.equal((await request(`chats/${chat.id}/messages`,'POST',{content:'测试'})).status,200);
 await json('settings','PUT',{apiKey:'',keepCurrent:true,remember:false});assert.equal((await json('settings')).configured,true);assert.equal(await vault.load(),'');
 await json('settings','PUT',{apiKey:'',keepCurrent:true,remember:true});assert.equal(await vault.load(),secret);
 await json('settings','DELETE');assert.equal((await json('settings')).configured,false);assert.equal(await vault.load(),'');
 await writeFile(vault.path,Buffer.from('corrupted ciphertext'));await stop();await start();assert.ok((await json('settings')).warning);assert.equal((await json('settings')).remembered,false);
 await json('settings','DELETE');assert.equal((await json('settings')).warning,'');
 }finally{await stop();await rm(root,{recursive:true,force:true});}
});
