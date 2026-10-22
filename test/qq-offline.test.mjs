// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QQChannel} from '../src/qq-channel.mjs';
import {readQQHistory,qqKey} from '../src/qq-history.mjs';
const selfId='123456789',peerId='987654321',roleId='12345678-1234-1234-1234-123456789012',base=Date.parse('2026-10-22T00:00:00Z');
function message(id,offset,sender=peerId,text='留言'+id){return {self_id:selfId,user_id:sender,message_id:id,real_seq:String(id),time:(base+offset)/1000,message_type:'private',sub_type:'friend',message:[{type:'text',data:{text}}]};}
test('offline history reads multiple pages chronologically, excludes other chats and already answered messages',async()=>{
 const rows=Array.from({length:100},(_,i)=>message(i+1,(i+1)*1000,i+1===60?selfId:peerId));let calls=[];
 const result=await readQQHistory({selfId,peerId,since:base+30000,now:base+200000,call:async(_,args)=>{calls.push(args);return {messages:args.message_seq==='0'?rows.slice(50):rows.slice(0,51)};}});
 assert.equal(calls.length,2);assert.equal(calls[1].message_seq,'51');assert.equal(calls[1].reverse_order,true);assert.equal(result.incoming.length,40);assert.equal(result.incoming[0].id,'61');assert.equal(result.incoming.at(-1).id,'100');assert.ok(result.answeredKeys.includes(qqKey(selfId,peerId,59)));
 const filtered=await readQQHistory({selfId,peerId,since:base,now:base+10000,call:async()=>({messages:[message(1,1000,'111111111'),{...message(2,2000),message_type:'group'},{...message(3,3000),self_id:'222222222'},message(4,4000),{...message(5,5000),message:[{type:'image',data:{}}]}]})});assert.deepEqual(filtered.incoming.map(r=>r.id),['4']);
});
test('offline recovery survives a week powered off, combines replies, preserves original times and does not repeat after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-offline-'));let now=base,history=[],sent=0,turns=[];
 const make=()=>new QQChannel({root,now:()=>now,canWork:()=>true,fetchImpl:async(url)=>Response.json({status:'ok',retcode:0,data:url.endsWith('get_login_info')?{user_id:selfId}:url.endsWith('get_friend_msg_history')?{messages:history}:{message_id:++sent}}),turn:async turn=>{turns.push(turn);await turn.send('补回回复',turn.replyId);}});
 let q=make();try{
  await q.init();await q.configure({enabled:true,selfId,peerId,roleId,proactive:false});q.close();now+=7*86400000;
  history=[message(1,3600000),message(2,3601000,selfId),message(3,2*86400000),message(4,3*86400000)];
  q=make();await q.init();await q.drain();assert.equal(sent,1);assert.equal(turns.length,1);assert.equal(turns[0].recovered,true);assert.deepEqual(turns[0].incomingMessages.map(m=>m.createdAt),[base+2*86400000,base+3*86400000]);assert.equal(q.state.jobs.at(-1).status,'done');assert.equal(q.state.recovery.totalAdded,2);
  q.close();q=make();await q.init();await q.drain();assert.equal(sent,1);assert.equal(q.state.recovery.added,0);
 }finally{q.close();await rm(root,{recursive:true,force:true});}
});
test('offline queued messages wait through login failures, and real-time duplicates are not recovered twice',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-offline-login-'));let now=base,online=false,sent=0;
 const q=new QQChannel({root,now:()=>now,canWork:()=>true,fetchImpl:async url=>{if(!online)throw Error('offline');return Response.json({status:'ok',retcode:0,data:url.endsWith('get_login_info')?{user_id:selfId}:url.endsWith('get_friend_msg_history')?{messages:[message(5,1000)]}:{message_id:++sent}});},turn:async turn=>turn.send('回复',turn.replyId)});
 try{
  await q.init();await q.configure({enabled:true,selfId,peerId,roleId});q.queueTexts([{key:qqKey(selfId,peerId,5),text:'实时上报',time:base+1000}]);await q.save();now+=2000;
  await q.drain();assert.equal(sent,0);assert.equal(q.state.jobs[0].status,'queued');assert.equal(q.state.recovery.status,'error');
  online=true;now+=31000;await q.drain();assert.equal(sent,1);assert.equal(q.state.jobs.length,1);assert.equal(q.state.recovery.added,0);
 }finally{q.close();await rm(root,{recursive:true,force:true});}
});
test('restart retries only proven pre-send jobs, and never replays confirmed or uncertain deliveries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-offline-crash-'));let q=new QQChannel({root,canWork:()=>true,turn:async()=>{}});
 try{
  await q.init();await q.configure({enabled:true,selfId,peerId,roleId});
  q.state.jobs=['retry','sent','unknown'].map(id=>({id,status:'running',replyId:id,messages:[{id:'user-'+id,content:id,createdAt:base}],text:id}));
  q.state.deliveries=[{id:'sent',jobId:'sent',status:'sent'},{id:'unknown',jobId:'unknown',status:'sending'}];await q.save();q.close();
  q=new QQChannel({root,canWork:()=>true,turn:async()=>{}});await q.init();assert.deepEqual(q.state.jobs.map(j=>j.status),['queued','done','interrupted']);assert.equal(q.state.jobs[0].messages[0].id,'user-retry');assert.equal(q.state.deliveries[1].status,'unknown');
 }finally{q.close();await rm(root,{recursive:true,force:true});}
});
test('incomplete or looping history never advances recovery checkpoint or silently skips messages',async()=>{
 const rows=Array.from({length:50},(_,i)=>message(i+1,(i+1)*1000));
 await assert.rejects(readQQHistory({selfId,peerId,since:base,now:base+100000,call:async()=>({messages:rows})}),/没有向更早/);
 await assert.rejects(readQQHistory({selfId,peerId,since:base,now:base+100000,call:async()=>({messages:rows}),maxPages:1}),/超过 2000/);
});
test('a proactive greeting is not treated as an answer to missed incoming messages',async()=>{
 const result=await readQQHistory({selfId,peerId,since:base,now:base+10000,ignoredOutgoingIds:['3'],call:async()=>({messages:[message(1,1000,selfId),message(2,2000),message(3,3000,selfId)]})});assert.deepEqual(result.incoming.map(r=>r.id),['2']);
});
