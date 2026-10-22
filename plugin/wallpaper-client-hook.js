// SPDX-License-Identifier: GPL-3.0-or-later
// Installed inside dsh-plugin-wallpaper-engine 1.3.3's client factory by
// scripts/install-wallpaper-adapter.mjs. Uses its existing selection/apply/store.
function installMuseWallpaperControl(){
 const clientId=crypto.randomUUID();let active=true,timer=null,ack=null,controller=null;
 // apiJson prefixes relative paths with /wallpaper-engine, so use an absolute
 // app-origin URL for the companion plugin's separate route.
 const endpoint=new URL('/muse-multi-agent/wallpaper/client',window.location.href).href;
 function snapshot(){
  const w=selection.inventory.wallpapers.find(w=>w.id===selection.id);
  return {scope:'dsh-client-background',id:selection.id||'',title:w?.title||'',type:selection.type||null,
   scrim:selection.scrim,wallpaper_blur:selection.wallpaperBlur,playback_rate:selection.playbackRate,
   video_volume:selection.videoVolume,flip:selection.flip,object_fit:selection.objectFit,
   rotation_enabled:selection.rotationEnabled,blocked_note:selection.blockedNote||'',
   media_error:selection.videoError||'',media_ready:!!(selection.videoPlaying||selection.sceneLiveActive)};
 }
 const allowed=w=>!(selection.hiddenIds||[]).includes(w.id)&&keepPlayingWallpaper(w,selection.contentRatingFilter);
 async function execute(command){
  if(!selection.loaded)throw Error('壁纸目录尚未加载，请稍后再试。');
  const args=command.args||{};
  if(command.action==='status')return snapshot();
  if(command.action==='list'){
   const limit=args.limit??20;if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('limit 须为 1 到 50。');
   if(args.query!==undefined&&(typeof args.query!=='string'||args.query.length>200))throw Error('搜索词最多 200 字。');
   const query=(args.query||'').toLocaleLowerCase(),rows=selection.inventory.wallpapers.filter(w=>allowed(w)&&String(w.title||'').toLocaleLowerCase().includes(query));
   return {scope:'dsh-client-background',total:rows.length,wallpapers:rows.slice(0,limit).map(w=>({id:w.id,title:w.title||'',type:w.type,current:w.id===selection.id}))};
  }
  if(command.action!=='control'||!['select','clear','adjust'].includes(args.action))throw Error('无效壁纸操作。');
  const fields={scrim:['scrim',0,1],wallpaper_blur:['wallpaperBlur',0,60],playback_rate:['playbackRate',0.5,2],video_volume:['videoVolume',0,1]};
  const patch={};
  for(const [key,[target,min,max]] of Object.entries(fields))if(args[key]!==undefined){if(typeof args[key]!=='number'||!Number.isFinite(args[key])||args[key]<min||args[key]>max)throw Error(key+' 超出允许范围。');patch[target]=args[key];}
  if(args.flip!==undefined){if(typeof args.flip!=='boolean')throw Error('flip 须为布尔值。');patch.flip=args.flip;}
  if(args.object_fit!==undefined){if(!['cover','contain','center','fill'].includes(args.object_fit))throw Error('object_fit 无效。');patch.objectFit=args.object_fit;}
  if(Object.keys(args).some(k=>!['action','wallpaper_id','flip','object_fit',...Object.keys(fields)].includes(k)))throw Error('不支持的壁纸参数。');
  if(args.action==='select'){
   if(typeof args.wallpaper_id!=='string'||!selection.inventory.wallpapers.some(w=>w.id===args.wallpaper_id&&allowed(w)))throw Error('壁纸不存在、已隐藏或被当前筛选规则阻止。请先列出可用壁纸。');
  }else if(args.wallpaper_id!==undefined)throw Error('只有 select 可以指定 wallpaper_id。');
  if(args.action==='adjust'&&!Object.keys(patch).length)throw Error('请至少提供一个显示参数。');
  // Validate everything before touching the store. Reuse the plugin's normal
  // manual-pick path; never edit its persisted config behind the live UI.
  Object.assign(selection,patch);
  if(args.action!=='adjust'){
   selection.rotationEnabled=false;
   applySelection(args.action==='clear'?'':args.wallpaper_id,{fromManual:true});
  }
  persistSelection();emit();
  if(persistTimer){window.clearTimeout(persistTimer);persistTimer=null;}
  writeLocalCache();await pushPersisted();
  if(persistDirty)throw Error('界面已收到变更，但保存失败；请检查背景与插件设置，不要自动重试。');
  const result=snapshot();
  if(result.blocked_note)throw Error('背景未能应用：'+result.blocked_note);
  return {applied:true,persisted:true,...result};
 }
 async function poll(){
  if(!active)return;
  try{
   controller=new AbortController();const sentAck=ack;
   const response=await apiJson(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Muse-UI':'1'},body:JSON.stringify({clientId,visible:!document.hidden,ack:sentAck}),signal:controller.signal});
   if(!active)return;
   if(response.ok&&!response.error){
    if(ack===sentAck)ack=null;
    for(const command of response.data?.commands||[]){
     try{ack={id:command.id,receipt:command.receipt,result:await execute(command)};}
     catch(error){ack={id:command.id,receipt:command.receipt,error:String(error.message).slice(0,400)};}
    }
   }
  }catch{ /* Retry transport/ack only. Commands are delivered at most once. */ }
  finally{if(active)timer=window.setTimeout(poll,ack?20:750);}
 }
 poll();
 return()=>{active=false;window.clearTimeout(timer);controller?.abort();};
}
