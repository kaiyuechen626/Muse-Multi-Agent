// SPDX-License-Identifier: GPL-3.0-or-later
export function installQQRoleBinding({api,form,editor,getRoles}){
 const panel=document.createElement('section');panel.className='roleQQBinding';panel.setAttribute('aria-label','角色 QQ 绑定');
 panel.innerHTML='<h3>绑定 QQ 号</h3><p class="muted">填写给这个 AI 使用的 QQ 号，绑定后即可由它自动回复你。使用当前电脑已配置的 QQ 桥接；桥接需要先登录这个账号。</p><fieldset><label>给 AI 使用的 QQ 号<input class="self" inputmode="numeric" maxlength="16" autocomplete="off" placeholder="例如：3450155744"></label><label>我的 QQ 号（接收 AI 消息）<input class="peer" inputmode="numeric" maxlength="16" autocomplete="off"></label><label class="replaceLabel" hidden><input class="replace" type="checkbox"><span></span></label><div class="actions"><button class="bind primary" type="button">绑定并开启自动回复</button><button class="unbind" type="button">解除绑定</button><button class="refresh" type="button">刷新绑定信息</button><button class="connection" type="button">QQ 连接设置</button></div></fieldset><p class="state" role="status"></p><p class="error" role="alert"></p><p class="muted">绑定操作立即保存。当前本机桥接一次由一个角色使用；换到其他角色时需要勾选确认。角色人设的修改仍使用下方“保存角色”。</p>';
 form.querySelector('#importNotice').after(panel);const $=s=>panel.querySelector(s);let roleId=null,state=null,version=0,working=false;
 function show(value){
  state=value;$('.self').value=value.selfId;$('.peer').value=value.peerId;$('.replace').checked=false;
  const other=value.currentRoleId&&value.currentRoleId!==roleId,owner=getRoles().find(r=>r.id===value.currentRoleId)?.name||'另一个角色';
  $('.replaceLabel').hidden=!other;$('.replaceLabel span').textContent=`将 QQ ${value.currentSelfId} 从“${owner}”切换给当前角色`;
  $('.unbind').hidden=!value.bound;
  const connection=value.connection?.state,connectedText=connection==='online'?'桥接在线':connection==='wrong-account'?'桥接登录了其他账号，当前无法收发':connection==='offline'?'桥接离线，当前无法收发':'连接状态尚未检查';
  $('.state').textContent=value.bound?`已绑定 QQ ${value.selfId} · ${value.enabled?'自动回复开关已开启':'自动回复已暂停'} · ${connectedText}`:other?`当前桥接由“${owner}”使用。确认切换后，收到的消息将由当前角色回复。`:'当前角色未绑定 QQ。';
 }
 async function load(id){
  roleId=id;state=null;const ticket=++version;$('.error').textContent='';panel.hidden=!id;if(!id)return;
  $('fieldset').disabled=true;$('.state').textContent='正在读取 QQ 绑定…';
  try{const value=await api(`characters/${id}/qq-binding`);if(ticket===version)show(value);}catch(e){if(ticket===version){$('.state').textContent='QQ 绑定信息暂时无法读取';$('.error').textContent=e.message;}}
  finally{if(ticket===version)$('fieldset').disabled=false;}
 }
 const run=fn=>async()=>{if(working||!roleId)return;working=true;$('fieldset').disabled=true;const buttons=[...form.querySelectorAll('button')].map(button=>({button,disabled:button.disabled}));buttons.forEach(({button})=>button.disabled=true);$('.error').textContent='';try{await fn();}catch(e){$('.error').textContent=e.message;}finally{working=false;$('fieldset').disabled=false;buttons.forEach(({button,disabled})=>button.disabled=disabled);}};
 async function save(unbind=false){
  if(!state)throw Error('请先刷新绑定信息');
  const selfId=unbind?'':$('.self').value.trim();if(!unbind&&!selfId)throw Error('请填写给 AI 使用的 QQ 号');
  const value=await api(`characters/${roleId}/qq-binding`,'PUT',{selfId,peerId:$('.peer').value.trim(),replace:$('.replace').checked,expectedRoleId:state.currentRoleId,expectedSelfId:state.currentSelfId});
  show(value);$('.state').textContent=unbind?'已解除绑定，QQ 自动回复已暂停。聊天和记忆仍保留。':`QQ ${value.selfId} 已绑定当前角色，桥接连接成功，自动回复已开启。`;
 }
 $('.bind').onclick=run(()=>save());$('.unbind').onclick=run(()=>save(true));$('.refresh').onclick=run(()=>load(roleId));
 $('.connection').onclick=()=>window.dispatchEvent(new Event('muse-open-qq-settings'));
 editor.addEventListener('close',()=>{++version;roleId=null;state=null;});
 editor.addEventListener('cancel',event=>{if(working)event.preventDefault();});
 window.addEventListener('muse-qq-settings-closed',()=>{if(editor.open&&roleId&&!working)load(roleId);});
 return {load};
}
