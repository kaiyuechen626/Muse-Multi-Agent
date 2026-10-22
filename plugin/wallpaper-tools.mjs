// SPDX-License-Identifier: GPL-3.0-or-later
import {randomUUID,randomBytes} from 'node:crypto';

// Companion to wallpaper-client-hook.js. Commands are executed by the wallpaper
// plugin's own live selection store, then acknowledged after persistence.
export function installWallpaperTools(ctx,defineTool,{timeoutMs=15000}={}){
 const clients=new Map(),pending=new Map();let disposed=false;
 const finish=(id,error,result)=>{const job=pending.get(id);if(!job)return;pending.delete(id);clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.cancel);error?job.reject(error):job.resolve(result);};
 ctx.effect(()=>()=>{disposed=true;for(const id of pending.keys())finish(id,Error('壁纸适配器已卸载，操作结果未知，请检查界面。'));clients.clear();});
 ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/muse-multi-agent/wallpaper/client',handler:async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   const origin=req.headers.origin;
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers['x-muse-ui']!=='1'||origin&&origin!=='dsh-app://app'&&origin!==`http://127.0.0.1:${ctx.webServer.port}`)return send(403,{error:'仅允许 DSH 本机壁纸界面'});
   if(req.method!=='POST')return send(405,{error:'POST required'});
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>64000)return send(413,{error:'payload too large'});}
   const body=JSON.parse(raw||'{}');if(!/^[a-f0-9-]{36}$/.test(body.clientId||''))return send(400,{error:'invalid client'});
   const time=Date.now();for(const [id,client] of clients)if(time-client.seen>30000)clients.delete(id);
   if(!clients.has(body.clientId)&&clients.size>=8)return send(429,{error:'too many clients'});
   clients.set(body.clientId,{seen:time,visible:body.visible===true});
   if(body.ack){const a=body.ack,job=pending.get(a.id);if(job&&job.clientId===body.clientId&&job.receipt===a.receipt&&job.delivered){
    if(a.error)finish(a.id,Error(String(a.error).slice(0,400)));else if(a.result&&typeof a.result==='object')finish(a.id,null,a.result);
   }}
   const commands=[];for(const job of pending.values())if(job.clientId===body.clientId&&!job.delivered){job.delivered=true;commands.push({id:job.id,receipt:job.receipt,action:job.action,args:job.args});}
   return send(200,{commands});
  }catch{return send(400,{error:'invalid wallpaper client request'});}
 }}));
 function dispatch(action,args,signal){
  if(disposed)throw Error('壁纸适配器已卸载');signal?.throwIfAborted();
  const ready=[...clients].filter(([,c])=>Date.now()-c.seen<5000).sort((a,b)=>Number(b[1].visible)-Number(a[1].visible)||b[1].seen-a[1].seen);
  if(!ready.length)throw Error('DSH 壁纸控制界面未连接。请安装壁纸适配补丁并重启 DSH；不能仅凭文件工具控制背景。');
  if(pending.size)throw Error('另一个壁纸操作尚未结束，请等待结果后再操作。');
  return new Promise((resolve,reject)=>{
   const id=randomUUID(),job={id,receipt:randomBytes(16).toString('hex'),clientId:ready[0][0],action,args,signal,resolve,reject,delivered:false};
   job.cancel=()=>finish(id,Error(job.delivered?'壁纸操作已发送但结果未知，请核对背景，不要自动重试。':'壁纸操作在发送前已取消。'));
   job.timer=setTimeout(()=>finish(id,Error(job.delivered?'壁纸界面未确认结果，请检查背景，不要自动重试。':'壁纸界面未响应，操作未发送。')),timeoutMs);
   pending.set(id,job);signal?.addEventListener('abort',job.cancel,{once:true});if(signal?.aborted)job.cancel();
  });
 }
 const output={schema:{type:'json'},render:(_args,result)=>[{type:'text',text:JSON.stringify(result)}]};
 const register=(name,description,parameters,action)=>ctx.tools.register(defineTool({name,description,parameters,output,timeoutMs:timeoutMs+1000,isConcurrencySafe:()=>false,execute:(args,exec)=>dispatch(action,args,exec.signal)}));
 register('dsh_wallpaper_list','列出 DSH 客户端背景插件中当前允许使用的壁纸。用于选择 wallpaper_id；不控制 Windows 桌面的 Wallpaper Engine。',{query:{type:'string',description:'按标题筛选，可省略'},limit:{type:'integer',description:'最多返回 1 到 50 项，默认 20'}},'list');
 register('dsh_wallpaper_status','读取 DSH 客户端当前实际选择的背景及显示参数。',{},'status');
 register('dsh_wallpaper_control','切换或清除 DSH 客户端背景，或调整背景显示参数。切换前调用 dsh_wallpaper_list 获取 wallpaper_id。仅调整此 DSH 实例的背景，成功表示插件已应用并保存，不保证媒体解码成功。',{
  action:{type:'string',required:true,description:'select（切换）、clear（清除）或 adjust（只调参数）'},
  wallpaper_id:{type:'string',description:'list 返回的壁纸 ID，仅 select 必填'},
  scrim:{type:'number',description:'背景黑色遮罩 0 到 1'},
  wallpaper_blur:{type:'number',description:'背景模糊像素 0 到 60'},
  playback_rate:{type:'number',description:'播放速度 0.5 到 2'},
  video_volume:{type:'number',description:'视频音量 0 到 1'},
  flip:{type:'boolean',description:'是否水平翻转'},
  object_fit:{type:'string',description:'cover、contain、center 或 fill'},
 },'control');
}
