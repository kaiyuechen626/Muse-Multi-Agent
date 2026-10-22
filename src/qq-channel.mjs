// SPDX-License-Identifier: GPL-3.0-or-later
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {qqKey,readQQHistory} from './qq-history.mjs';
import {qqContent,resolveQQImage,validateImageData} from './qq-media.mjs';

const defaults={enabled:false,apiUrl:'http://127.0.0.1:3000',selfId:'',peerId:'',roleId:'',proactive:false,recoverOffline:true,intervalMinutes:180,dailyLimit:3,quietStart:23,quietEnd:8,timeZone:'Asia/Shanghai'};
export function validateQQ(input){
 const c={};for(const k of Object.keys(defaults))c[k]=input[k]??defaults[k];
 for(const k of ['enabled','proactive','recoverOffline'])if(typeof c[k]!=='boolean')throw Error('QQ 开关无效');
 const u=new URL(c.apiUrl);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('QQ 接口须为本机 http://127.0.0.1:端口');
 c.apiUrl=u.origin;
 for(const k of ['selfId','peerId'])if(typeof c[k]!=='string'||(c[k]&&!/^[1-9][0-9]{4,15}$/.test(c[k])))throw Error('请输入有效 QQ 号');
 if(c.selfId&&c.selfId===c.peerId)throw Error('AI 使用的 QQ 号与接收消息的 QQ 号须不同');
 if(typeof c.roleId!=='string'||(c.roleId&&!/^[a-f0-9-]{36}$/.test(c.roleId)))throw Error('请选择 Muse 角色');
 if(c.enabled&&(!c.selfId||!c.peerId||!c.roleId))throw Error('请填写两个 QQ 号并选择角色');
 for(const [k,min,max] of [['intervalMinutes',30,1440],['dailyLimit',1,20],['quietStart',0,23],['quietEnd',0,23]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw Error('主动聊天时间或频率无效');
 try{new Intl.DateTimeFormat('en',{timeZone:c.timeZone}).format();}catch{throw Error('时区无效');}
 return c;
}
export function qqClock(config,now){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));const h=+parts.hour,s=config.quietStart,e=config.quietEnd;return {day:`${parts.year}-${parts.month}-${parts.day}`,quiet:s===e?false:s<e?h>=s&&h<e:h>=s||h<e};}
export class QQChannel{
 constructor({root,turn,canWork,fetchImpl=fetch,now=Date.now}){this.file=join(root,'qq-channel.json');this.turn=turn;this.canWork=canWork;this.fetch=fetchImpl;this.now=now;this.working=false;this.closed=false;this.writeQueue=Promise.resolve();}
 async init(){
  try{this.state=JSON.parse(await readFile(this.file,'utf8'));this.state.config=validateQQ(this.state.config);}catch(e){if(e.code!=='ENOENT')throw e;this.state={config:{...defaults},token:'',secret:randomBytes(32).toString('hex'),seen:[],jobs:[],activity:0,nextAt:0,count:0,day:'',deliveries:[]};}
  // Never replay an interrupted send: QQ may have accepted it before the process stopped.
  this.state.recovery??={since:Math.floor(this.now()/1000)*1000,cursorTime:0,status:'waiting',added:0};
  this.catchupSince=Math.max(this.state.recovery.since,(this.state.recovery.cursorTime||0)-120000);this.catchupUntil=this.now()+180000;
  for(const job of this.state.jobs)if(['running','failed'].includes(job.status)){
   const delivery=this.state.deliveries.findLast(d=>d.jobId===job.id);
   job.status=delivery?.status==='sent'?'done':job.messages&&!delivery?'queued':'interrupted';
   if(job.status==='interrupted')this.state.error='服务中断，有一条消息未确认完成；请在 QQ 核对后继续。';
  }
  for(const d of this.state.deliveries)if(d.status==='sending')d.status='unknown';
  await this.save();
 }
 start(){this.timer=setInterval(()=>this.drain().catch(()=>{this.state.error='QQ 后台处理失败，请检查本地数据目录。';}),5000);this.timer.unref();}
 close(){this.closed=true;clearInterval(this.timer);this.controller?.abort();this.historyController?.abort();}
 save(){this.state.revision=(this.state.revision||0)+1;const snapshot=JSON.stringify(this.state),file=this.file;const next=this.writeQueue.catch(()=>{}).then(async()=>{const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,snapshot,{mode:0o600});await rename(temp,file);});this.writeQueue=next;return next;}
 activity(){return {revision:this.state.revision,chatId:this.state.chatId||null,working:this.working};}
 binding(roleId){const c=this.state.config,own=c.roleId===roleId;return {roleId,bound:own&&!!c.selfId,selfId:own?c.selfId:'',peerId:c.peerId,enabled:own&&c.enabled,currentRoleId:c.roleId,currentSelfId:c.selfId};}
 async bindingStatus(roleId){
  const result=this.binding(roleId);if(!result.bound)return result;
  try{const login=await this.action('get_login_info',{},AbortSignal.timeout(3000));return {...result,connection:{state:String(login?.user_id)===result.selfId?'online':'wrong-account'}};}
  catch(error){return {...result,connection:{state:'offline',error:error.message}};}
 }
 async bindRole(roleId,input){
  if(this.working||this.recovering||this.configuring||this.accepting)throw Error('QQ 正在处理消息，请稍后绑定');
  this.configuring=true;
  try{
   const current=this.state.config;
   if(input.expectedRoleId!==current.roleId||input.expectedSelfId!==current.selfId)throw Error('QQ 绑定已变化，请刷新绑定信息后重试');
   if(this.state.jobs.some(j=>['queued','running'].includes(j.status)))throw Error('请先等待 QQ 待处理消息完成，再更换绑定');
   if(typeof input.selfId!=='string')throw Error('请输入要给 AI 使用的 QQ 号');
   let next;
   if(!input.selfId.trim()){
    if(current.roleId!==roleId)throw Error('当前角色没有绑定 QQ');
    next=validateQQ({...current,enabled:false,roleId:''});
   }else{
    if(current.roleId&&current.roleId!==roleId&&input.replace!==true)throw Error('这个桥接已绑定其他角色，请先确认切换角色');
    next=validateQQ({...current,selfId:input.selfId.trim(),peerId:typeof input.peerId==='string'?input.peerId.trim():current.peerId,roleId,enabled:true,proactive:current.roleId===roleId&&current.selfId===input.selfId.trim()?current.proactive:false});
    const login=await this.action('get_login_info',{});
    if(String(login?.user_id)!==next.selfId)throw Error(`本机 QQ 桥接没有登录 ${next.selfId}，请先让桥接登录这个账号`);
    const friends=await this.action('get_friend_list',{});
    if(!Array.isArray(friends)||!friends.some(f=>String(f.user_id)===next.peerId))throw Error('接收消息的 QQ 号不在该账号的好友列表中');
   }
   await this.commitConfig(next);const result=this.binding(roleId);return result.bound?{...result,connection:{state:'online'}}:result;
  }finally{this.configuring=false;}
 }
 async commitConfig(config,token=this.state.token){
  const previous=structuredClone(this.state);
  const changed=['selfId','peerId','roleId'].some(k=>config[k]!==this.state.config[k]);
  if(changed){this.state.jobs=[];this.state.seen=[];delete this.state.chatId;this.state.activity=0;this.state.recovery={since:Math.floor(this.now()/1000)*1000,cursorTime:0,status:'waiting',added:0};this.nextHistoryAt=0;}
  this.state.config=config;this.state.token=token;
  this.state.nextAt=this.now()+config.intervalMinutes*60000;this.state.error='';
  try{await this.save();}catch(e){this.state=previous;throw e;}
 }
 status(){return {config:this.state.config,tokenConfigured:!!this.state.token,webhookSecret:this.state.secret,working:this.working||!!this.recovering,recovery:this.state.recovery,chatId:this.state.chatId||null,error:this.state.error||'',lastIncoming:this.state.activity||null,nextAt:this.state.nextAt||null,queued:this.state.jobs.filter(j=>j.status==='queued').length,deliveries:this.state.deliveries.slice(-10)};}
 async configure(input){
  if(this.working||this.recovering||this.configuring||this.accepting)throw Error('QQ 正在处理消息，请稍后保存');this.configuring=true;
  try{
   const config=validateQQ(input);
   if(input.token!==undefined&&(typeof input.token!=='string'||input.token.length>512||/[\r\n]/.test(input.token)))throw Error('QQ Token 无效');
   await this.commitConfig(config,input.token??this.state.token);return this.status();
  }finally{this.configuring=false;}
 }
 async action(name,args,signal){
  let response;const timeout=name==='send_qzone_msg'?90000:15000;try{response=await this.fetch(`${this.state.config.apiUrl}/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...(this.state.token?{Authorization:`Bearer ${this.state.token}`}:{})},body:JSON.stringify(args),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});}catch{throw Error(['send_private_msg','send_qzone_msg'].includes(name)?'无法确认 QQ 接口结果，请检查桥接服务；发送失败时请先在 QQ 核对。':'无法连接 QQ 桥接。桥接可能已退出或尚未登录；仅打开普通 QQ 客户端无法连接。账号绑定仍然保留。');}
  if(!response.ok)throw Error('QQ 接口请求失败，请检查地址和 Token');
  const data=await response.json();if(data.status!=='ok'||data.retcode!==0)throw Error('QQ 接口未成功执行，请检查桥接日志');return data.data;
 }
 async test(){const login=await this.action('get_login_info',{});if(String(login?.user_id)!==this.state.config.selfId)throw Error('桥接登录的 QQ 号与配置的 AI QQ 号不一致');return {ok:true,userId:String(login.user_id)};}
 queueTexts(rows,source='live'){
  let added=0,job;
  for(const row of rows){
   if(this.state.seen.includes(row.key))continue;
   if(!job||job.text.length+row.text.length+2>30000||job.messages.length>=50||job.messages.reduce((n,m)=>n+(m.imageRefs?.length||0),0)+(row.images?.length||0)>4){
    if(this.state.jobs.filter(j=>['queued','running'].includes(j.status)).length>=100)break;
    job={id:randomUUID(),replyId:randomUUID(),text:'',messages:[],status:'queued',source,at:this.now()};this.state.jobs.push(job);
   }
   job.messages.push({id:randomUUID(),content:row.text,createdAt:row.time,qqKey:row.key,...(row.images?.length?{imageRefs:row.images.map(ref=>({...ref,id:randomUUID()}))}:{})});job.text+=(job.text?'\n\n':'')+row.text;
   this.state.seen.push(row.key);added++;
  }
  this.state.seen=this.state.seen.slice(-5000);this.state.jobs=this.state.jobs.filter((j,i)=>['queued','running'].includes(j.status)||i>=this.state.jobs.length-100);
  return added;
 }
 async recoverOffline(manual=false){
  if(this.closed||this.working||this.recovering||this.accepting||this.configuring||!this.state.config.enabled||!this.state.config.recoverOffline||!this.canWork(manual))throw Error('请先开启 QQ 自动回复和离线补回，或等待当前操作完成');
  this.recovering=true;this.historyController=new AbortController();
  const recovery=this.state.recovery;recovery.status='checking';
  try{
   await this.test();
   const c=this.state.config,boundary=Math.max(recovery.since,(recovery.cursorTime||0)-120000),since=this.now()<this.catchupUntil?Math.max(recovery.since,Math.min(boundary,this.catchupSince)):boundary;
   const history=await readQQHistory({call:(action,args)=>this.action(action,args,this.historyController.signal),selfId:c.selfId,peerId:c.peerId,since,now:this.now(),ignoredOutgoingIds:this.state.deliveries.filter(d=>d.proactive&&d.qqMessageId).map(d=>d.qqMessageId)});
   const answered=new Set(history.answeredKeys);
   for(const job of this.state.jobs)if(job.status==='queued'&&job.messages?.some(m=>answered.has(m.qqKey))){job.messages=job.messages.filter(m=>!answered.has(m.qqKey));job.text=job.messages.map(m=>m.content).join('\n\n');if(!job.messages.length)job.status='answered-externally';}
   const fresh=history.incoming.filter(r=>!this.state.seen.includes(r.key));
   const added=this.queueTexts(fresh,'offline');
   this.state.seen=[...new Set([...this.state.seen,...history.answeredKeys])].slice(-5000);
   if(added===fresh.length)recovery.cursorTime=Math.min(this.now(),history.latestTime);
   recovery.status=added<fresh.length?'pending':'done';recovery.added=added;recovery.lastCheck=this.now();recovery.totalAdded=(recovery.totalAdded||0)+added;delete recovery.error;
   if(added){this.state.activity=this.now();this.state.nextAt=this.now()+c.intervalMinutes*60000;}
   await this.save();return this.status();
  }catch(e){recovery.status='error';recovery.error=e.message;recovery.lastCheck=this.now();await this.save();throw e;}
  finally{this.nextHistoryAt=this.now()+30000;this.recovering=false;this.historyController=null;}
 }
 authorized(raw,headers){const actual=headers['x-signature']||'',expected='sha1='+createHmac('sha1',this.state.secret).update(raw).digest('hex');return typeof actual==='string'&&actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
 async handleEvent(req,res){
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.method!=='POST'||req.headers.origin)return reply(403,{error:'需要本地 QQ 上报'});
  if(this.configuring||this.accepting)return reply(503,{error:'请稍后重试'});
  this.accepting=true;
  try{
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>65536)return reply(413,{error:'事件过大'});chunks.push(c);}const raw=Buffer.concat(chunks);
   if(!this.authorized(raw,req.headers))return reply(403,{error:'QQ 签名无效'});
   const event=JSON.parse(raw),c=this.state.config;
   if(!c.enabled||event.post_type!=='message'||event.message_type!=='private'||event.sub_type!=='friend'||String(event.self_id)!==c.selfId||String(event.user_id)!==c.peerId)return reply(200,{ignored:true});
   if(!Number.isSafeInteger(event.time)||event.time*1000>this.now()+300000||event.time*1000<(c.recoverOffline?this.state.recovery.since:this.now()-86400000))return reply(400,{error:'QQ 事件时间无效'});
   const id=String(event.message_id??'');if(!/^-?\d{1,24}$/.test(id))return reply(400,{error:'消息 ID 无效'});
   const key=qqKey(c.selfId,c.peerId,id);if(this.state.seen.includes(key))return reply(200,{duplicate:true});
   const parsed=qqContent(event.message);if(!parsed)return reply(200,{ignored:true});
   if(this.state.jobs.filter(j=>['queued','running'].includes(j.status)).length>=100)return reply(503,{error:'QQ 队列已满'});
   this.queueTexts([{key,...parsed,time:event.time*1000}]);
   this.state.activity=this.now();this.state.nextAt=this.now()+c.intervalMinutes*60000;await this.save();reply(200,{accepted:true});
  }catch{if(!res.headersSent)reply(400,{error:'QQ 事件保存失败或格式无效'});}finally{this.accepting=false;}
 }
 async execute(job,manual=false){
  if(this.closed||this.working||this.recovering||this.configuring||this.accepting||!this.state.config.enabled||!this.canWork(manual))throw Error('QQ 未开启或 Muse 正忙，请稍后重试');
  this.working=true;this.controller=new AbortController();
  try{
   await this.test();
   if(job){job.messages??=[{id:randomUUID(),content:job.text,createdAt:job.at}];job.replyId??=randomUUID();job.status='running';await this.save();}
   const result=await this.turn({config:this.state.config,chatId:this.state.chatId,text:job?.text,incomingMessages:job?.messages,replyId:job?.replyId,recovered:job?.source==='offline',proactive:!job,signal:this.controller.signal,resolveImage:ref=>resolveQQImage(ref,(name,args)=>this.action(name,args,this.controller.signal),this.fetch,this.controller.signal),setChat:async id=>{this.state.chatId=id;await this.save();},send:async(text,messageId,images=[])=>{
    if(!Array.isArray(images)||images.length>4)throw Error('每次最多发送 4 张图片');
    const message=[...(text&&text!=='[图片]'?[{type:'text',data:{text}}]:[]),...images.map(i=>({type:'image',data:{file:'base64://'+validateImageData(i.dataUrl).split(',')[1]}}))];
    if(!message.length)throw Error('QQ 回复内容为空');
    const delivery={id:messageId,jobId:job?.id,at:this.now(),status:'sending',proactive:!job};this.state.deliveries.push(delivery);this.state.deliveries=this.state.deliveries.slice(-100);await this.save();
    delivery.imageCount=images.length;
    try{const sent=await this.action('send_private_msg',{user_id:this.state.config.peerId,message},this.controller.signal);if(sent?.message_id===undefined)throw Error('QQ 未返回消息 ID');delivery.status='sent';delivery.qqMessageId=String(sent.message_id);}catch(e){delivery.status='unknown';throw e;}finally{await this.save();}
   }});
   if(job)job.status='done';this.state.error='';return result;
  }catch(e){if(job&&job.status==='running')job.status='failed';this.state.error=e.message;this.nextWorkAt=this.now()+30000;throw e;}
  finally{this.state.nextAt=this.now()+this.state.config.intervalMinutes*60000;try{await this.save();}finally{this.working=false;this.controller=null;}}
 }
 async nudge(manual=false){
  const c=this.state.config,clock=qqClock(c,this.now());if(!c.proactive)throw Error('请先开启主动聊天');if(clock.quiet)throw Error('当前处于免打扰时段');
  if(this.state.day!==clock.day){this.state.day=clock.day;this.state.count=0;}
  if(this.state.count>=c.dailyLimit)throw Error('今天主动聊天已达上限');
  if(this.state.jobs.some(j=>['queued','running'].includes(j.status)))throw Error('请先等待收到的消息处理完毕');
  // Reserve the daily quota before generating or sending, including ambiguous failures.
  if(this.working||this.recovering||this.accepting||this.configuring||!this.canWork(manual)||!c.enabled)throw Error('QQ 未开启或 Muse 正忙');
  this.state.count++;return this.execute(null,manual);
 }
 async drain(){
  if(this.closed||this.working||this.recovering||this.accepting||this.configuring||!this.state.config.enabled||!this.canWork(false))return;
  if(this.state.config.recoverOffline&&this.now()>=(this.nextHistoryAt||0))try{await this.recoverOffline();}catch{/* Recovery status explains unavailable history; live replies can continue. */}
  if(this.closed||this.now()<(this.nextWorkAt||0)||!this.canWork(false))return;
  const job=this.state.jobs.find(j=>j.status==='queued');
  try{if(job)await this.execute(job);else if((!this.state.config.recoverOffline||this.state.recovery.status==='done'&&this.now()>=this.catchupUntil)&&this.state.config.proactive&&this.now()>=this.state.nextAt)await this.nudge();}catch{/* Visible status retains failure; never resend automatically. */}
 }
}
