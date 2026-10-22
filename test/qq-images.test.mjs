// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomUUID,createHmac} from 'node:crypto';
import http from 'node:http';
import {qqContent,qqImageURL,resolveQQImage,imageReply,validateImageData,QQImages} from '../src/qq-media.mjs';
import {createApp} from '../src/server.mjs';
import {readQQHistory} from '../src/qq-history.mjs';
import {cleanSyncRecord} from '../src/full-backup.mjs';
import {exportChat,importChat} from '../src/chat-management.mjs';
import {extractMemory} from '../src/automatic-memory.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aon8AAAAASUVORK5CYII=';
const dataUrl='data:image/png;base64,'+png;
const selfId='123456789',peerId='987654321';
test('QQ image references accept mixed messages, reject local/network paths and validate binary format',async()=>{
 const parsed=qqContent([{type:'text',data:{text:'看看这张'}},{type:'image',data:{file:'abc.jpg'}}]);assert.equal(parsed.text,'看看这张');assert.equal(parsed.images.length,1);
 for(const file of ['C:\\secret.png','file:///secret','http://127.0.0.1/private','../secrets'])assert.equal(qqContent([{type:'image',data:{file}}]),null);
 assert.equal(qqContent([{type:'image',data:{file:'abc.jpg'}}]).text,'[图片]');assert.equal(qqContent([{type:'record',data:{file:'abc'}}]),null);
 assert.equal(qqContent(Array.from({length:5},()=>({type:'image',data:{file:'abc.jpg'}}))),null);
 for(const url of ['https://127.0.0.1/image','http://gchat.qpic.cn/a','https://evil.test/a','https://gchat.qpic.cn:8080/a','https://user:pass@gchat.qpic.cn/a'])assert.equal(qqImageURL(url),false);
 assert.equal(qqImageURL('https://gchat.qpic.cn/a'),true);assert.equal(validateImageData(dataUrl),dataUrl);
 assert.throws(()=>validateImageData('data:image/jpeg;base64,'+png));assert.throws(()=>validateImageData('data:image/png;base64,'+Buffer.from('<svg/>').toString('base64')));
 assert.equal(await resolveQQImage({file:'abc'},async()=>({base64:png})),dataUrl);
 let fetched=false;await assert.rejects(resolveQQImage({file:'abc'},async()=>({file:'C:\\private.png',url:'http://127.0.0.1/secret'}),async()=>{fetched=true;}));assert.equal(fetched,false);
 const id=randomUUID();const available=[{id,dataUrl,description:'测试图片'}];assert.equal(imageReply('给你看 [[QQ_IMAGE:'+id+']]',available).images.length,1);assert.throws(()=>imageReply('[[QQ_IMAGE:unknown]]',available));
});
test('QQ gallery is role scoped and survives restart; transcript images survive backup and chat import',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-image-gallery-')),role={id:randomUUID(),name:'桃子'};
 try{let gallery=new QQImages(root);await gallery.init();const item=await gallery.add(role.id,{dataUrl,description:'挥手'});gallery=new QQImages(root);await gallery.init();assert.equal(gallery.list(role.id).length,1);assert.equal(gallery.list(randomUUID()).length,0);
 const now=Date.now(),chat={schemaVersion:1,id:randomUUID(),characterId:role.id,characterName:role.name,title:'图片聊天',createdAt:now,updatedAt:now,messages:[{id:randomUUID(),role:'user',content:'图片识别',originalContent:'看图',images:[{id:item.id,dataUrl,description:'挥手'}],createdAt:now}]};
 assert.equal(cleanSyncRecord('chats',chat).messages[0].images[0].dataUrl,dataUrl);const imported=importChat(JSON.parse(exportChat(chat,'json')),role);assert.equal(imported.messages[0].images[0].dataUrl,dataUrl);assert.equal(imported.messages[0].originalContent,'看图');assert.match(exportChat(chat,'md'),/data:image\/png;base64/);await gallery.remove(role.id,item.id);assert.equal(gallery.list(role.id).length,0);
 }finally{await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
test('offline history includes image-only incoming messages',async()=>{
 const now=Date.now(),result=await readQQHistory({selfId,peerId,since:now-10000,now,call:async()=>({messages:[{self_id:selfId,user_id:peerId,message_id:1,message_type:'private',sub_type:'friend',time:Math.floor(now/1000),message:[{type:'image',data:{file:'old.jpg'}}]}]})});
 assert.equal(result.incoming.length,1);assert.equal(result.incoming[0].images[0].file,'old.jpg');
});
test('automatic memory uses human caption instead of treating vision descriptions as user facts',async()=>{
 let latest;await extractMemory([{role:'user',originalContent:'看看这张图',content:'看看这张图\n模型猜测用户喜欢猫'}],null,'fake',{provider:async(_,h)=>{latest=JSON.parse(h[0].content).latestUser;return {content:'{"memories":[]}',finishReason:'stop'};}});assert.equal(latest,'看看这张图');
});
test('signed QQ image is recognized, remembered as transcript, replied with a real image, and never duplicated',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-image-http-'));let app,base,sends=[],vision=0,answers=0,selectedImageId,failVision=false,oldDenial=false,planning=0;
 const bridge=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;res.setHeader('Content-Type','application/json');let data;
  if(req.url==='/get_login_info')data={user_id:selfId};else if(req.url==='/get_image')data={base64:png};else if(req.url==='/get_friend_msg_history')data={messages:[]};else if(req.url==='/send_private_msg'){sends.push(JSON.parse(raw));data={message_id:sends.length};}else data=[];
  res.end(JSON.stringify({status:'ok',retcode:0,data}));});bridge.listen(0,'127.0.0.1');await once(bridge,'listening');
 const provider=async(role,history)=>{if(role.name==='QQ 图片选择助手'){planning++;assert.ok(JSON.parse(history[0].content).available.some(i=>i.id===selectedImageId));return {content:JSON.stringify({imageIds:[selectedImageId]}),finishReason:'stop'};}if(role.name==='图片理解助手'){vision++;assert.equal(role.model,'deepseek-flash');assert.equal(history[0].content[1].image_url.url,dataUrl);if(failVision)throw Error('vision unavailable');return {content:'图片中是一只蓝色猫咪。',finishReason:'stop'};}answers++;assert.match(role.persona,/温柔/);if(oldDenial){assert.match(role.postHistory,/会随你的回复实际发送/);return {content:'我发不了图。',finishReason:'stop'};}if(failVision){assert.match(history.at(-1).content,/不能声称看到了/);return {content:'这张图片暂时看不清，可以再发一次吗？',finishReason:'stop'};}assert.match(history.at(-1).content,/蓝色猫咪/);assert.match(role.systemPrompt,/挥手/);return {content:'好可爱，给你挥挥手！ [[QQ_IMAGE:'+selectedImageId+']]',finishReason:'stop'};};
 const api=async(path,method='GET',body)=>{const response=await fetch(base+'/api/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
 const until=async fn=>{for(let i=0;i<250;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Image turn timed out');};
 try{
  app=await createApp({dataDir:root,provider,memoryExtractor:null,memoryProvider:null});app.listen(0,'127.0.0.1');await once(app,'listening');base=`http://127.0.0.1:${app.address().port}`;
  await api('settings','PUT',{apiKey:'fake'});const role=await api('characters','POST',{name:'桃子',persona:'温柔'});const item=await api(`characters/${role.id}/qq-images`,'POST',{dataUrl,description:'挥手打招呼'});selectedImageId=item.id;
  const state=await api('qq','PUT',{enabled:true,recoverOffline:false,selfId,peerId,roleId:role.id,apiUrl:`http://127.0.0.1:${bridge.address().port}`});
  const post=async (id,text='这张图是什么？',withImage=true)=>{const raw=JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',time:Math.floor(Date.now()/1000),self_id:selfId,user_id:peerId,message_id:id,message:[{type:'text',data:{text}},...(withImage?[{type:'image',data:{file:'cat.jpg'}}]:[])]});return (await fetch(base+'/api/qq/events',{method:'POST',headers:{'Content-Type':'application/json','X-Signature':'sha1='+createHmac('sha1',state.webhookSecret).update(raw).digest('hex')},body:raw})).json();};
  assert.equal((await post(10)).accepted,true);await until(async()=>sends.length===1&&!(await api('qq')).working);
  assert.equal(vision,1);assert.equal(answers,1);assert.equal(sends[0].user_id,peerId);assert.equal(sends[0].message[1].type,'image');assert.equal(sends[0].message[1].data.file,'base64://'+png);assert.ok(!sends[0].message[0].data.text.includes('QQ_IMAGE'));
  const status=await api('qq'),chat=await api('chats/'+status.chatId);assert.equal(chat.messages.length,2);assert.equal(chat.messages[0].images[0].description,'图片中是一只蓝色猫咪。');assert.equal(chat.messages[1].images[0].id,item.id);assert.equal(cleanSyncRecord('chats',chat).messages[0].images[0].dataUrl,dataUrl);
  assert.equal((await post(10)).duplicate,true);assert.equal(sends.length,1);
  failVision=true;assert.equal((await post(11)).accepted,true);await until(async()=>sends.length===2&&!(await api('qq')).working);assert.equal(sends[1].message.length,1);assert.match(sends[1].message[0].data.text,/暂时看不清/);
  failVision=false;oldDenial=true;assert.equal((await post(12,'把刚才的图片发给我',false)).accepted,true);await until(async()=>sends.length===3&&!(await api('qq')).working);assert.equal(planning,1);assert.equal(sends[2].message.length,1);assert.equal(sends[2].message[0].type,'image');
 }finally{if(app){app.close();await once(app,'close');}bridge.close();await once(bridge,'close');await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
