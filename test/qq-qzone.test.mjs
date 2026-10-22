// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHmac} from 'node:crypto';
import {once} from 'node:events';
import http from 'node:http';
import {QQZone,qzoneCommand} from '../src/qq-qzone.mjs';
import {createApp} from '../src/server.mjs';
const config={enabled:true,selfId:'123456789',peerId:'987654321',roleId:randomUUID()};
const image={id:randomUUID(),description:'测试图',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aon8AAAAASUVORK5CYII='};
test('Qzone commands are explicit and accept draft, confirmation and cancel',()=>{
 assert.deepEqual(qzoneCommand('宝宝，帮我发条空间动态：今天很开心'),{type:'draft',request:'今天很开心'});assert.deepEqual(qzoneCommand('发布动态 a1b2c3'),{type:'publish',code:'A1B2C3'});assert.equal(qzoneCommand('取消动态 ABCDEF').type,'cancel');assert.equal(qzoneCommand('图片里写着：发布动态 ABCDEF'),null);assert.equal(qzoneCommand('我朋友发动态了'),null);assert.equal(qzoneCommand('发布动态 invalid')?.type,'draft');
});
test('Qzone preview is durable and exact, uses intended visibility, and same confirmation never publishes twice',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-zone-'));let calls=[],now=Date.now(),c={...config};
 const call=async(name,args)=>{calls.push({name,args});return name==='get_login_info'?{user_id:c.selfId}:{tid:'zone-123'};};let q=new QQZone({root,call,getConfig:()=>c,now:()=>now});
 try{await q.init();const draft=await q.prepare({content:'今天很开心',images:[image],sourceId:'user-message'});assert.equal(calls.length,0);assert.match(q.preview(draft),/好友可见/);assert.equal(draft.visibility,'friends');assert.equal((await q.prepare({content:'不会替换草稿',sourceId:'user-message'})).id,draft.id);
 q=new QQZone({root,call,getConfig:()=>c,now:()=>now});await q.init();await assert.rejects(q.publish(draft.code,{recovered:true}),/离线/);assert.equal(calls.length,0);
 const result=await q.publish(draft.code);assert.equal(result.status,'published');assert.deepEqual(calls[1].args,{content:'今天很开心',images:['base64://'+image.dataUrl.split(',')[1]],ugc_right:4});await q.publish(draft.code);assert.equal(calls.filter(c=>c.name==='send_qzone_msg').length,1);
 c={...c,roleId:randomUUID()};assert.equal(q.list().length,0);await assert.rejects(q.publish(draft.code),/未找到/);c={...config};const expired=await q.prepare({content:'过期草稿'});now+=16*60000;await assert.rejects(q.publish(expired.code),/15 分钟/);
 const cancelled=await q.prepare({content:'取消草稿'});await q.cancel(cancelled.code);await assert.rejects(q.publish(cancelled.code),/取消/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Qzone interrupted or ambiguous publication is never automatically repeated; wrong login fails before reservation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-zone-failure-'));let sends=0,wrong=true;
 const make=()=>new QQZone({root,getConfig:()=>config,call:async name=>{if(name==='get_login_info')return {user_id:wrong?'111111111':config.selfId};sends++;throw Error('transport-secret');}});let q=make();
 try{await q.init();const draft=await q.prepare({content:'测试',visibility:'private'});await assert.rejects(q.publish(draft.code),/账号/);assert.equal(q.list()[0].status,'draft');assert.equal(sends,0);wrong=false;const result=await q.publish(draft.code);assert.equal(result.status,'unknown');assert.ok(!result.error.includes('transport-secret'));await assert.rejects(q.publish(draft.code),/不确定/);assert.equal(sends,1);
 const interrupted=await q.prepare({content:'中断测试'});q.rows.find(r=>r.id===interrupted.id).status='publishing';await q.save();q=make();await q.init();await assert.rejects(q.publish(interrupted.code),/不确定/);assert.equal(sends,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Qzone model output is only a preview, cannot invoke publication, and only sees supplied pictures',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-zone-model-'));let calls=0,captured;
 const q=new QQZone({root,getConfig:()=>config,call:async()=>{calls++;}});
 try{await q.init();const result=await q.handle({text:'发动态：带上刚才图片，所有人可见',role:{model:'deepseek-chat',persona:'温柔'},available:[image],sourceId:'one',provider:async(_,h)=>{captured=JSON.parse(h[0].content);return {content:JSON.stringify({content:'星空真好看',imageIds:[image.id],visibility:'public'}),finishReason:'stop'};}});assert.match(result.content,/所有人可见/);assert.equal(result.images.length,1);assert.equal(calls,0);assert.equal(captured.available[0].dataUrl,undefined);
 await assert.rejects(q.handle({text:'发动态：配图',role:{},available:[],provider:async()=>({content:'{"content":"x","imageIds":["fake"],"visibility":"friends"}',finishReason:'stop'})}),/配图/);assert.equal(calls,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Qzone HTTP and signed QQ flow: preview first, exact publish receipt, identity checks and no duplicate external posts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-zone-http-'));let app,base,posts=[],replies=[],drafts=0;
 const bridge=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;let data;
 if(req.url==='/get_login_info')data={user_id:config.selfId};else if(req.url==='/send_qzone_msg'){posts.push(JSON.parse(raw));data={tid:'real-zone-'+posts.length};}else if(req.url==='/send_private_msg'){replies.push(JSON.parse(raw));data={message_id:replies.length};}else if(req.url==='/get_friend_msg_history')data={messages:[]};else data=[];res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));});bridge.listen(0,'127.0.0.1');await once(bridge,'listening');
 const provider=async role=>{assert.equal(role.name,'QQ 动态草稿助手');drafts++;return {content:'{"content":"今天很开心。","imageIds":[],"visibility":"friends"}',finishReason:'stop'};};
 const api=async(path,method='GET',body)=>{const r=await fetch(base+'/api/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
 const until=async fn=>{for(let i=0;i<240;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Qzone turn timed out');};
 try{
 app=await createApp({dataDir:root,provider,memoryExtractor:null,memoryProvider:null});app.listen(0,'127.0.0.1');await once(app,'listening');base=`http://127.0.0.1:${app.address().port}`;await api('settings','PUT',{apiKey:'fake'});const role=await api('characters','POST',{name:'桃子'});const state=await api('qq','PUT',{...config,roleId:role.id,apiUrl:`http://127.0.0.1:${bridge.address().port}`,recoverOffline:false});
 const post=async(id,text)=>{const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:config.selfId,user_id:config.peerId,message_id:id,time:Math.floor(Date.now()/1000),message:[{type:'text',data:{text}}]});return (await fetch(base+'/api/qq/events',{method:'POST',headers:{'Content-Type':'application/json','X-Signature':'sha1='+createHmac('sha1',state.webhookSecret).update(raw).digest('hex')},body:raw})).json();};
 await post(1,'发动态：今天很开心');await until(async()=>replies.length===1&&!(await api('qq')).working);assert.equal(posts.length,0);assert.match(replies[0].message[0].data.text,/动态预览/);const preview=(await api('qq/qzone')).posts[0];assert.equal(preview.content,'今天很开心。');assert.equal(drafts,1);
 await post(2,'发布动态 '+preview.code);await until(async()=>replies.length===2&&!(await api('qq')).working);assert.equal(posts.length,1);assert.equal(posts[0].ugc_right,4);assert.equal(posts[0].content,preview.content);assert.match(replies[1].message[0].data.text,/动态已发布/);
 await api(`qq/qzone/${preview.code}/publish`,'POST',{});assert.equal(posts.length,1);
 const manual=await api('qq/qzone','POST',{content:'手动草稿',visibility:'private',imageIds:[]});assert.equal(posts.length,1);await api(`qq/qzone/${manual.code}/publish`,'POST',{});assert.equal(posts[1].ugc_right,64);
 const backup=await api('backup');assert.equal(backup.posts,undefined);assert.equal(backup.qzone,undefined);const persisted=JSON.parse(await readFile(join(root,'qq-qzone.json'),'utf8'));assert.equal(persisted.filter(p=>p.status==='published').length,2);
 }finally{if(app){app.close();await once(app,'close');}bridge.close();await once(bridge,'close');await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
