// SPDX-License-Identifier: GPL-3.0-or-later
export function requestDshPairing(win=window){
 if(win.parent===win||new URLSearchParams(win.location.search).get('embed')!=='dsh')return Promise.reject(Error('请在 DSH 的 Muse 面板中使用一键连接，或手动粘贴配对码。'));
 const requestId=win.crypto.randomUUID();
 return new Promise((resolve,reject)=>{
  const finish=(error,code)=>{win.clearTimeout(timer);win.removeEventListener('message',receive);error?reject(error):resolve(code);};
  const receive=e=>{
   if(e.source!==win.parent||e.origin!=='dsh-app://app'||e.data?.type!=='muse:pair-result'||e.data.requestId!==requestId)return;
   if(e.data.error)return finish(Error('DSH 连接失败，请使用手动配对。'));
   if(!/^\d{1,5}:[a-f0-9]{48}$/.test(e.data.code||''))return finish(Error('DSH 返回的配对码无效。'));
   finish(null,e.data.code);
  };
  const timer=win.setTimeout(()=>finish(Error('DSH 未响应，请重启 DSH 以加载新版插件，或使用手动配对。')),5000);
  win.addEventListener('message',receive);
  win.parent.postMessage({type:'muse:pair-request',requestId},'dsh-app://app');
 });
}
export function installDshSettings({api,settings,getRoles,getChat}){
 const button=document.createElement('button');button.type='button';button.textContent='DSH 插件与工具';settings.querySelector('.modelSettings').append(button);
 const dialog=document.createElement('dialog');dialog.innerHTML=`
 <div class="dialogHead"><h2>DSH 插件与工具</h2><button type="button" class="close">关闭</button></div>
 <p>连接 DSH → 选择当前角色和 DSH 会话 → 选择授权方式并保存，AI 即可在聊天中调用插件工具。</p>
 <div class="actions"><button class="connect">一键连接 DSH</button><button class="disconnect">撤销连接</button><button class="reload">刷新工具目录</button></div>
 <details><summary>手动配对（备用）</summary><p>在 DSH 的 Muse 面板顶部生成配对码，再粘贴到这里。</p><label>DSH 配对码<input class="code" autocomplete="off" placeholder="端口:配对码"></label><button class="pair">配对</button></details>
 <p role="status"></p><p>配对和授权仅在两端本次运行期间有效，重启后需重新连接。工具继承所选 DSH 会话的工作区和权限，需要审批时请在 DSH 处理。请选择空闲会话。</p>
 <label>Muse 角色<select class="role"></select></label><label>绑定已打开的 DSH 会话<select class="agent"></select></label>
 <label><input class="auto" type="checkbox" style="width:auto">自动使用此 DSH 会话的全部工具（包含以后新增和更新的工具）</label>
 <p>自动模式会跟随 DSH 的实时工具目录。只提供界面、未暴露 AI 工具的插件仍需适配。DSH 的工作区、审批和沙箱规则继续生效。</p>
 <div class="actions"><button class="all">勾选全部工具</button><button class="none">取消全部勾选</button></div><p class="count"></p><div class="tools"></div><button class="save">保存角色授权</button>
 <hr><button class="history">查看当前聊天的工具记录</button><div class="runs"></div>`;
 document.body.append(dialog);const $=s=>dialog.querySelector(s);let catalog=[],grants={},working=false;const status=$('[role=status]');
 $('.connect').hidden=window.parent===window||new URLSearchParams(location.search).get('embed')!=='dsh';
 const option=(value,label)=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;};
 function count(){const n=$('.tools').querySelectorAll('input:checked').length;$('.count').textContent=$('.auto').checked?`自动接入全部工具：当前 ${n} 项；以后新增工具自动可用。点击“保存角色授权”后生效。`:`已勾选 ${n} 项工具；点击“保存角色授权”后生效。`;}
 function drawTools(){
  const a=catalog.find(a=>a.id===$('.agent').value),g=grants[$('.role').value];$('.tools').replaceChildren();
  for(const t of a?.tools||[]){const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=t.name;c.checked=$('.auto').checked||g?.agentId===a.id&&g.tools.includes(t.name);c.disabled=working||$('.auto').checked;c.style.width='auto';c.onchange=count;l.append(c,document.createTextNode(` ${t.name} — ${t.description||''}`));$('.tools').append(l);}
  if(!a?.tools.length)$('.tools').textContent=a?'此会话没有可用工具。请在 DSH 启用所需插件并检查会话配置，再刷新目录。':'请先在 DSH 打开一个会话，然后刷新工具目录。';
  $('.save').disabled=working||!a||!$('.role').value;$('.all').disabled=working||!a?.tools.length;$('.none').disabled=working||!a?.tools.length;count();
 }
 function selectBinding(){const g=grants[$('.role').value];if(g&&catalog.some(a=>a.id===g.agentId))$('.agent').value=g.agentId;$('.auto').checked=g?.allTools===true;drawTools();}
 async function reload(){
  const previous=$('.agent').value,state=await api('dsh');grants=state.grants;catalog=[];
  if(state.paired)catalog=(await api('dsh/catalog')).agents;
  $('.agent').replaceChildren(...catalog.map(a=>option(a.id,`${a.name}（${a.tools.length} 项工具）`)));
  if(catalog.some(a=>a.id===previous))$('.agent').value=previous;
  status.textContent=state.paired?'已连接 DSH。请选择会话和工具后保存角色授权。':'尚未连接 DSH。';selectBinding();
 }
 const run=fn=>async()=>{
  if(working)return;working=true;dialog.querySelectorAll('button,select,input').forEach(el=>el.disabled=true);
  try{await fn();}catch(e){status.textContent=e.message;}
  finally{working=false;dialog.querySelectorAll('button,select,input').forEach(el=>el.disabled=false);drawTools();}
 };
 $('.close').onclick=()=>dialog.close();dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
 button.onclick=run(async()=>{
  $('.role').replaceChildren(...getRoles().map(r=>option(r.id,r.name)));const current=getChat()?.characterId;if(current)$('.role').value=current;
  $('.code').value='';$('.runs').replaceChildren();dialog.showModal();await reload();
 });
 $('.connect').onclick=run(async()=>{status.textContent='正在连接 DSH…';const code=await requestDshPairing();await api('dsh/pair','POST',{code});await reload();});
 $('.pair').onclick=run(async()=>{await api('dsh/pair','POST',{code:$('.code').value.trim()});$('.code').value='';await reload();});
 $('.disconnect').onclick=run(async()=>{await api('dsh/revoke','POST',{});await reload();});$('.reload').onclick=run(reload);
 $('.agent').onchange=drawTools;$('.role').onchange=selectBinding;$('.auto').onchange=drawTools;
 for(const [selector,checked] of [['.all',true],['.none',false]])$(selector).onclick=()=>{$('.auto').checked=false;$('.tools').querySelectorAll('input').forEach(c=>{c.checked=checked;c.disabled=false;});count();};
 $('.save').onclick=run(async()=>{const allTools=$('.auto').checked,data={roleId:$('.role').value,agentId:$('.agent').value,allTools,tools:allTools?[]:[...$('.tools').querySelectorAll('input:checked')].map(c=>c.value)};await api('dsh/grant','POST',data);grants[data.roleId]=data;status.textContent=allTools?'已开启自动接入。此角色可使用 DSH 当前和以后新增的全部可用工具。':data.tools.length?`已授权 ${data.tools.length} 项工具。现在可返回聊天，让此角色使用 DSH 插件。`:'已撤销此角色的全部工具权限。';});
 $('.history').onclick=run(async()=>{const c=getChat();if(!c)throw Error('请先打开一个聊天');const current=await api(`chats/${c.id}`);$('.runs').replaceChildren();for(const r of current.toolRuns||[]){const box=document.createElement('pre');box.style.whiteSpace='pre-wrap';box.style.overflowWrap='anywhere';box.textContent=`${new Date(r.createdAt).toLocaleString()} · ${r.tool} · ${r.status==='running'?'已提交（如生成已结束则结果未知）':r.status}\n参数：${JSON.stringify(r.args)}\n${r.result||''}`;$('.runs').append(box);}if(!current.toolRuns?.length)$('.runs').textContent='当前聊天尚无工具调用记录。';});
}


