// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
const root=await mkdtemp(join(tmpdir(),'muse-clean-install-'));
const originalKey=process.env.DEEPSEEK_API_KEY;delete process.env.DEEPSEEK_API_KEY;
let server,base;
async function start(name){server=await createApp({dataDir:join(root,name),provider:async()=>({content:'INSTALL_TEST_OK',finishReason:'stop'}),memoryExtractor:null});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;}
async function stop(){if(server){await new Promise(r=>server.close(r));server=null;}}
async function api(p,method='GET',body){const r=await fetch(base+'/api/'+p,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.ok,true,JSON.stringify(data));return data;}
try{
 await start('source');assert.equal((await fetch(base)).status,200);
 for(const p of ['/app.js','/style.css','/dsh-settings.js','/LICENSE','/NOTICE'])assert.equal((await fetch(base+p)).status,200,p);
 assert.equal((await api('health')).app,'muse-multi-agent');
 const role=await api('characters','POST',{name:'安装检查角色',persona:'仅用于自动测试',greeting:'欢迎'});
 const chat=await api('chats','POST',{characterId:role.id});await api('settings','PUT',{apiKey:'installation-test-only'});
 const reply=await api(`chats/${chat.id}/messages`,'POST',{content:'测试'});assert.equal(reply.messages.at(-1).content,'INSTALL_TEST_OK');
 const backup=await api('backup');assert.ok(!JSON.stringify(backup).includes('installation-test-only'));
 await stop();await start('source');assert.equal((await api(`chats/${chat.id}`)).messages.at(-1).content,'INSTALL_TEST_OK');
 await stop();await start('restore');await api('backup','POST',{backup,preview:true});await api('backup','POST',{backup,preview:false});assert.equal((await api(`chats/${chat.id}`)).messages.at(-1).content,'INSTALL_TEST_OK');
 console.log('PASS: clean data start, static assets/legal notices, role/chat, simulated reply, backup/restore and restart. No real model or DSH installation claimed.');
}finally{await stop();await rm(root,{recursive:true,force:true});if(originalKey!==undefined)process.env.DEEPSEEK_API_KEY=originalKey;}
