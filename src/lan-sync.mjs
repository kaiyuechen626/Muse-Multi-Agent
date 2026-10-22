// SPDX-License-Identifier: GPL-3.0-or-later
import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {seal,open,digest,mergeThree,proof} from './lan-sync-codec.mjs';
import {cleanSyncRecord} from './full-backup.mjs';
import {IdentityMerges} from './lan-sync-identities.mjs';
const runFile=promisify(execFile),kinds=['characters','chats','memories'];
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
export function localAddress(ip=''){return ip==='127.0.0.1'||ip==='::1'||/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip.replace(/^::ffff:/,''));}
export class LanSync{
 constructor({store,canSync=()=>true,port=3212,discoveryPort=32113,adbPath=process.env.MUSE_ADB_PATH||'adb'}){this.store=store;this.canSync=canSync;this.port=port;this.discoveryPort=discoveryPort;this.adbPath=adbPath;this.folder=join(store.root,'lan-sync');this.syncing=false;this.queue=Promise.resolve();this.pairing=null;this.http=null;this.udp=null;this.responses=new Map();}
 async init(){await mkdir(this.folder,{recursive:true});try{this.state=JSON.parse(await readFile(join(this.folder,'state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.state={version:1,id:randomUUID(),enabled:false,seq:0,devices:{},rows:{},operations:{},conflicts:[]};await this.save();}this.identities=new IdentityMerges(this);this.identities.init();await this.identities.recover();if(this.state.enabled)await this.start();}
 async save(){const target=join(this.folder,'state.json'),temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(this.state),{mode:0o600});await rename(temp,target);}
 addresses(){return Object.values(os.networkInterfaces()).flat().filter(a=>a&&!a.internal&&a.family==='IPv4'&&localAddress(a.address)).map(a=>a.address);}
 status(){return {enabled:this.state.enabled,listening:!!this.http,revision:this.state.seq,serverId:this.state.id,port:this.http?.address()?.port||this.port,addresses:this.addresses(),devices:Object.entries(this.state.devices).map(([id,d])=>({id,name:d.name,pairedAt:d.pairedAt,lastSync:d.lastSync||null})),conflicts:this.state.conflicts.map(c=>({id:c.id,kind:c.kind,recordId:c.recordId,createdAt:c.createdAt,deviceName:c.deviceName})),nameMatches:this.identities.pending(),roleMerges:Object.keys(this.state.roleAliases).map(from=>({from,to:this.identities.canonical(from)})),syncing:this.syncing,error:this.lastError||null};}
 async resolveNameMatch(id,merge,canProceed=this.canSync){if(!uuid(id))throw Error('无效角色合并请求');const job=this.queue.then(async()=>{if(!canProceed())throw Error('请等待聊天或保存结束后再合并');this.syncing=true;try{await this.identities.decide(id,merge);await this.snapshot();await this.save();return this.status();}finally{this.syncing=false;}});this.queue=job.catch(()=>{});return job;}
 hasPendingIdentityMerge(){return Object.values(this.state.mergeJobs).some(job=>job.status==='pending');}
 async start(){if(this.http)return this.status();const server=http.createServer((req,res)=>this.handle(req,res));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.port,'0.0.0.0',resolve);});server.on('error',e=>{this.lastError='局域网服务异常：'+e.code;});this.http=server;this.state.enabled=true;await this.save();
  const udp=dgram.createSocket('udp4');udp.on('error',e=>{this.lastError='自动发现不可用（仍可使用已保存地址）：'+e.code;});udp.on('message',(data,remote)=>{try{if(!localAddress(remote.address)||data.length>1000)return;const q=JSON.parse(data),d=this.state.devices[q.deviceId];if(!d||q.type!=='muse-sync-discover'||!uuid(q.nonce))return;const response={type:'muse-sync-here',serverId:this.state.id,port:this.http.address().port,nonce:q.nonce};response.mac=proof(d.key,`${response.serverId}:${response.port}:${q.nonce}`);udp.send(Buffer.from(JSON.stringify(response)),remote.port,remote.address);}catch{}});udp.bind(this.discoveryPort,'0.0.0.0');this.udp=udp;return this.status();
 }
 async stop(){this.pairing=null;if(this.udp){this.udp.close();this.udp=null;}if(this.http){const server=this.http;this.http=null;server.closeIdleConnections();await new Promise(r=>server.close(r));}}
 async disable(){await this.stop();this.state.enabled=false;await this.save();return this.status();}
 async createPairing(mode='qr'){await this.start();if(!['qr','usb'].includes(mode))throw Error('无效配对方式');const pairing={id:randomUUID(),key:randomBytes(32).toString('base64url'),expires:Date.now()+180000,mode,used:false};this.pairing=pairing;const host=mode==='usb'?'127.0.0.1':this.addresses()[0];if(!host)throw Error('未找到局域网地址，请连接 Wi-Fi 或网线');const data={v:1,serverId:this.state.id,host,port:this.http.address().port,pairId:pairing.id,key:pairing.key,mode};return {uri:'muse-sync://pair/'+Buffer.from(JSON.stringify(data)).toString('base64url'),expires:pairing.expires,mode};}
 async usbPair(){let stdout;try{({stdout}=await runFile(this.adbPath,['devices'],{timeout:5000,windowsHide:true}));}catch{throw Error('无法启动 ADB，请安装 Android platform-tools 并检查路径；也可选择扫码配对');}const devices=stdout.split(/\r?\n/).map(s=>s.trim().split(/\s+/)).filter(r=>r[1]==='device'&&!r[0].includes(':'));if(devices.length!==1)throw Error('请仅连接一部手机，开启 USB 调试并在手机上允许此电脑；也可选择扫码配对');const p=await this.createPairing('usb'),serial=devices[0][0];try{await runFile(this.adbPath,['-s',serial,'reverse','tcp:'+this.port,'tcp:'+this.http.address().port],{timeout:5000,windowsHide:true});await runFile(this.adbPath,['-s',serial,'shell','am','start','-a','android.intent.action.VIEW','-d',p.uri,'io.zer0.muse.cyrene'],{timeout:7000,windowsHide:true});}catch{this.pairing=null;throw Error('USB 配对请求未能发送，请确认手机已允许 USB 调试并安装兼容版本，或改用扫码配对');}return {ok:true,expires:p.expires,message:'请在手机上确认配对。USB 仅用于首次连接，以后通过局域网同步。'};}
 async revoke(id){delete this.state.devices[id];await this.save();return this.status();}
 async snapshot(){
  const seen=new Set();for(const kind of kinds)for(const raw of await this.store.list(kind)){const body=cleanSyncRecord(kind,raw),key=kind+':'+body.id;seen.add(key);const old=this.state.rows[key];if(!old||digest(body)!==old.hash)this.update(kind,body.id,body);}
  for(const [key,row] of Object.entries(this.state.rows))if(!seen.has(key)&&row.body!==null)this.update(row.kind,row.id,null);
 }
 update(kind,id,body){const key=kind+':'+id,old=this.state.rows[key],history={...(old?.history||{})};if(old)history[old.revision]=old.body;const revisions=Object.keys(history).sort((a,b)=>+a-+b);while(revisions.length>12)delete history[revisions.shift()];const row={kind,id,revision:++this.state.seq,body,hash:digest(body),history};this.state.rows[key]=row;return row;}
 async apply(kind,id,body){if(body===null){const existing=await this.store.get(kind,id);if(existing)await this.store.remove(kind,id);return;}await this.store.put(kind,cleanSyncRecord(kind,body));}
 async exchange(deviceId,input){
  if(!this.state.devices[deviceId])throw Error('设备配对已撤销');
  if(!this.canSync())return {busy:true,retryAfter:5000};
  if(!Array.isArray(input.changes)||input.changes.length>64||!Number.isSafeInteger(input.cursor)||input.cursor<0||input.cursor>this.state.seq)throw Error('无效同步批次');
  this.syncing=true;const startRevision=this.state.seq;try{
   await this.identities.recover();
   const answers=input.nameDecisions||[];if(!Array.isArray(answers)||answers.length>64)throw Error('无效合并选择');for(const a of answers){if(!uuid(a.id))throw Error('无效合并选择');await this.identities.decide(a.id,a.merge);}
   await this.snapshot();if(this.state.seq!==startRevision)await this.save();const acks=[],device=this.state.devices[deviceId];
   const wait={acks:[],rows:[],cursor:input.cursor,hasMore:false,serverId:this.state.id,acceptedNameDecisions:answers.map(a=>a.id)};
   const directives=this.identities.directives(input,device);if(directives){await this.save();return {...wait,...directives,nameMatches:this.identities.pending()};}
   const nameMatches=await this.identities.discover(deviceId,input);if(nameMatches.length)return {...wait,nameMatches};
   for(const change of input.changes){
    if(!kinds.includes(change.kind)||!uuid(change.id)||!uuid(change.opId)||!Number.isSafeInteger(change.baseRevision)||change.baseRevision<0)throw Error('无效同步记录');
    const key=change.kind+':'+change.id,opKey=deviceId+':'+change.opId,old=this.state.rows[key],body=change.body===null?null:cleanSyncRecord(change.kind,change.body);
    if(body&&body.id!==change.id)throw Error('同步身份不一致');
    if((change.kind==='characters'||change.kind==='memories')&&this.identities.canonical(change.id)!==change.id||body&&change.kind==='chats'&&this.identities.canonical(body.characterId)!==body.characterId)throw Error('角色已经合并，请更新身份映射后重试');
    if(Buffer.byteLength(JSON.stringify(body))>7800000)throw Error('单条资料超过同步限制，请先拆分过长对话');
    const requestHash=digest({kind:change.kind,id:change.id,body,baseRevision:change.baseRevision});
    const done=this.state.operations[opKey];if(done){if(done.requestHash!==requestHash)throw Error('重复操作标识对应不同内容');const row=this.state.rows[key],ack={...done.ack};if(row?.revision===ack.revision)ack.body=row.body;else if(row&&Object.hasOwn(row.history,ack.revision))ack.body=row.history[ack.revision];else{ack.revision=row?.revision||0;ack.body=row?.body??null;}acks.push(ack);continue;}
    const seed=this.identities.seed(device,input,change,old,body);let merged=seed?.body??body,conflict=null;
    if(!seed&&old&&old.hash!==digest(body)&&old.revision!==change.baseRevision){try{if(!Object.hasOwn(old.history,change.baseRevision))throw Error();merged=mergeThree(old.history[change.baseRevision],old.body,body);}catch{conflict={id:randomUUID(),kind:change.kind,recordId:change.id,createdAt:Date.now(),deviceName:this.state.devices[deviceId].name,local:old.body,incoming:body};}}
    if(!old&&change.baseRevision!==0)throw Error('同步基线不存在');
    if(conflict)this.state.conflicts.push(conflict);
    else if(!old||digest(merged)!==old.hash){if(Buffer.byteLength(JSON.stringify(merged))>7800000)throw Error('合并后资料超过同步限制');await this.apply(change.kind,change.id,merged);this.update(change.kind,change.id,merged);}
    const row=this.state.rows[key],ack={opId:change.opId,kind:change.kind,id:change.id,revision:row?.revision||0,body:row?.body??null,conflictId:conflict?.id||null};acks.push(ack);const {body:ackBody,...receipt}=ack;this.state.operations[opKey]={requestHash,ack:receipt};
    if(seed)device.mergeBootstrap.seeded[seed.key]=true;
   }
   const rows=[];let bytes=Buffer.byteLength(JSON.stringify(acks));for(const {history,...row} of Object.values(this.state.rows).filter(r=>r.revision>input.cursor).sort((a,b)=>a.revision-b.revision)){const size=Buffer.byteLength(JSON.stringify(row));if(size>8000000)throw Error('单条资料超过同步大小限制，请先拆分过长对话');if(rows.length>=64||bytes+size>16000000)break;rows.push(row);bytes+=size;}
   const operationKeys=Object.keys(this.state.operations);while(operationKeys.length>4096)delete this.state.operations[operationKeys.shift()];
   const completedBootstrap=input.completeIdentityMerge===true&&input.changes.length===0&&device.mergeBootstrap?.version===input.identityMergeVersion;if(completedBootstrap)delete device.mergeBootstrap;
   this.state.devices[deviceId].lastSync=Date.now();if(this.state.seq!==startRevision||input.changes.length||completedBootstrap)await this.save();return {acks,rows,cursor:rows.at(-1)?.revision??input.cursor,hasMore:Object.values(this.state.rows).some(r=>r.revision>(rows.at(-1)?.revision??input.cursor)),serverId:this.state.id,conflicts:this.state.conflicts.length,nameMatches:[],acceptedNameDecisions:answers.map(a=>a.id),completedIdentityMerge:completedBootstrap};
  }finally{this.syncing=false;}
 }
 async handle(req,res){
  const send=(status,value)=>{const body=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});res.end(body);};
  try{
   if(!localAddress(req.socket.remoteAddress)||req.headers.origin)return send(403,{error:'仅接受已配对的本机或局域网应用'});
   if(req.method!=='POST'||!['/pair','/exchange'].includes(req.url))return send(404,{error:'not found'});
   let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24000000)return send(413,{error:'batch too large'});chunks.push(chunk);}const envelope=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!uuid(envelope.requestId))throw Error('无效请求');
   if(req.url==='/pair'){
    const p=this.pairing;if(!p||p.used||p.expires<Date.now()||p.id!==envelope.pairId)return send(403,{error:'配对码已失效'});
    const input=open(p.key,`pair:request:${p.id}:${envelope.requestId}`,envelope.payload);if(!uuid(input.deviceId)||this.state.devices[input.deviceId]||typeof input.name!=='string'||input.name.length>100)throw Error('无效设备');
    p.used=true;const device={key:randomBytes(32).toString('base64url'),name:input.name,pairedAt:Date.now()};this.state.devices[input.deviceId]=device;await this.save();const result={deviceId:input.deviceId,key:device.key,serverId:this.state.id,serverName:os.hostname(),port:this.http.address().port,addresses:this.addresses(),discoveryPort:this.discoveryPort};return send(200,{requestId:envelope.requestId,payload:seal(p.key,`pair:response:${p.id}:${envelope.requestId}`,result)});
   }
   const device=this.state.devices[envelope.deviceId];if(!device)return send(403,{error:'设备未配对或已撤销'});
   const input=open(device.key,`sync:request:${envelope.deviceId}:${envelope.requestId}`,envelope.payload),cacheKey=envelope.deviceId+':'+envelope.requestId;
   if(this.responses.has(cacheKey))return send(200,this.responses.get(cacheKey));
   const job=this.queue.then(()=>this.exchange(envelope.deviceId,input));this.queue=job.catch(()=>{});const output=await job;const result={requestId:envelope.requestId,payload:seal(device.key,`sync:response:${envelope.deviceId}:${envelope.requestId}`,output)};this.responses.set(cacheKey,result);if(this.responses.size>256)this.responses.delete(this.responses.keys().next().value);return send(200,result);
  }catch{return send(400,{error:'同步请求校验或保存失败，请核对配对及同步状态'});}
 }
}
