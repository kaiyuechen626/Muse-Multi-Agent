// SPDX-License-Identifier: GPL-3.0-or-later
import {installQQZone} from './qq-qzone.js';
export function installQQSettings({api,settings}){
 const button=document.createElement('button');button.type='button';button.textContent='QQ 私聊接入';settings.querySelector('.modelSettings').append(button);
 const dialog=document.createElement('dialog');dialog.className='qqSettings';dialog.setAttribute('aria-label','QQ 私聊接入');
 dialog.innerHTML=`<div class="dialogHead"><h2>QQ 私聊接入</h2><button type="button" class="close">关闭</button></div>
 <p>让同一个 Muse 角色通过 QQ 与你聊天，使用已有记忆。聊天与记忆可通过现有局域网同步传到手机。</p>
 <p>需要在本机安装并运行 NapCat（OneBot 11）。仅登录普通 QQ 客户端无法接入。AI 使用的账号和你的账号需要互为好友；支持好友文字和图片私聊。</p>
 <form><label><input name="enabled" type="checkbox">开启 QQ 自动回复</label>
 <label>AI 使用的 QQ 号<input name="selfId" inputmode="numeric" maxlength="16" autocomplete="off"></label>
 <label>你的 QQ 号（唯一收件人）<input name="peerId" inputmode="numeric" maxlength="16" autocomplete="off"></label>
 <label>Muse 角色<select name="roleId"></select></label>
 <label>NapCat HTTP 地址<input name="apiUrl" placeholder="http://127.0.0.1:3000" required></label>
 <label>NapCat HTTP Access Token<input name="token" type="password" autocomplete="off" placeholder="留空保留已保存值"></label><label><input name="clearToken" type="checkbox">清除已保存的 Access Token</label>
 <label><input name="proactive" type="checkbox">允许角色主动给我发消息</label>
 <label><input name="recoverOffline" type="checkbox">上线后自动补回离线期间的文字和图片消息</label>
 <p class="muted">重新登录后检查与你的私聊历史，连续留言合并回复；已经回复过或发送结果不确定的消息不会自动重发。需要 QQ 保留并同步这些记录。</p>
 <label>主动聊天间隔（分钟，30–1440）<input name="intervalMinutes" type="number" min="30" max="1440" required></label>
 <label>每日主动聊天上限（1–20）<input name="dailyLimit" type="number" min="1" max="20" required></label>
 <label>免打扰开始（0–23 点）<input name="quietStart" type="number" min="0" max="23" required></label>
 <label>免打扰结束（0–23 点）<input name="quietEnd" type="number" min="0" max="23" required></label>
 <label>时区<input name="timeZone" required placeholder="Asia/Shanghai"></label>
 <p class="muted">免打扰仅限制主动聊天；开始与结束相同表示全天可主动聊天。收到消息后重新计算间隔。电脑、Muse 与 NapCat 需要持续运行。</p>
 <div class="actions"><button type="submit" class="primary">保存设置</button><button type="button" class="test">测试连接</button><button type="button" class="nudge">主动聊一句</button><button type="button" class="refresh">刷新状态</button></div></form>
 <p role="status" aria-live="polite"></p><p class="recovery" role="status"></p><button type="button" class="recover">立即检查离线消息</button><p role="alert"></p><p class="chat"></p><div class="deliveries"></div>
 <details class="imageSettings"><summary>角色图片库</summary><p>上方所选角色可以按图片说明选择发图，也可以发回最近收到的图片。单张不超过 2 MB，支持 PNG、JPEG、WebP、GIF，每轮最多 4 张。收到的图片会交给 DeepSeek 识别，并与识图结果一起保存在聊天中。</p><label>添加图片<input class="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><label>图片说明<input class="imageDescription" maxlength="500" placeholder="例如：桃子开心地挥手，适合打招呼"></label><button type="button" class="imageAdd">加入当前角色图片库</button><p class="imageStatus" role="status"></p><div class="qqGallery"></div></details>
 <details><summary>配置 NapCat 消息上报</summary><p>HTTP 服务端开启后，将上方地址与 Access Token 填入 Muse。再开启 HTTP 客户端（事件上报），消息格式选择 array，配置下方 URL，将下方签名密钥填入客户端 Token 字段（与服务端 Access Token 分开）。用于 X-Signature（HMAC-SHA1）签名。</p><label>事件上报 URL<input class="eventUrl" readonly></label><label>事件签名密钥（HTTP 客户端 Token）<input class="secret" type="password" readonly></label><p>账号与连接信息只保存在本机 data/qq-channel.json，不随手机同步或完整备份传输。请保护该文件，不要上传或分享。</p></details>`;
 document.body.append(dialog);installQQZone({api,dialog});const $=s=>dialog.querySelector(s),form=$('form');let working=false;
 const run=fn=>async event=>{event?.preventDefault();if(working)return;working=true;$('[role=alert]').textContent='';dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){$('[role=alert]').textContent=e.message;}finally{working=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}};
 function show(state){
  const recovery=state.recovery||{};$('.recovery').textContent=state.config.recoverOffline?`离线补回：${({waiting:'等待 QQ 登录',checking:'正在检查历史',done:'检查完成',pending:'消息较多，继续补回',error:'暂不可用'})[recovery.status]||'等待检查'}${recovery.lastCheck?' · '+new Date(recovery.lastCheck).toLocaleString():''}${recovery.added?' · 本次补回 '+recovery.added+' 条':''}${recovery.error?' · '+recovery.error:''}`:'离线补回已关闭';
  $('[role=status]').textContent=`${state.config.enabled?'QQ 接入已开启':'QQ 接入已暂停'} · ${state.working?'正在处理消息':'等待消息'} · 排队 ${state.queued} 条${state.nextAt&&state.config.proactive?' · 下次主动聊天检查 '+new Date(state.nextAt).toLocaleString():''}${state.error?' · '+state.error:''}`;
  $('.eventUrl').value=location.origin+'/api/qq/events';$('.secret').value=state.webhookSecret;$('.chat').textContent=state.chatId?'QQ 记录已保存到 Muse 本地聊天。返回主界面刷新聊天列表即可查看。':'';
  $('.deliveries').replaceChildren();for(const d of state.deliveries){const p=document.createElement('p');p.textContent=`${new Date(d.at).toLocaleString()} · ${d.proactive?'主动消息':'回复'} · ${{sent:'QQ 接口已确认发送',sending:'发送中',unknown:'发送结果不确定，请在 QQ 核对，系统不会自动重发'}[d.status]||d.status}`;$('.deliveries').append(p);}
 }
 async function gallery(){const roleId=form.elements.roleId.value;$('.qqGallery').replaceChildren();$('.imageStatus').textContent=roleId?'正在读取图库…':'请先在上方选择角色';if(!roleId)return;const {images}=await api(`characters/${roleId}/qq-images`);if(form.elements.roleId.value!==roleId)return;$('.imageStatus').textContent=`已保存 ${images.length} / 20 张图片`;for(const item of images){const box=document.createElement('article'),img=document.createElement('img'),description=document.createElement('p'),remove=document.createElement('button');img.src=item.dataUrl;img.alt=item.description;description.textContent=item.description;remove.type='button';remove.textContent='从图片库移除';remove.onclick=run(async()=>{await api(`characters/${roleId}/qq-images/${item.id}`,'DELETE');await gallery();});box.append(img,description,remove);$('.qqGallery').append(box);}}
 form.elements.roleId.onchange=run(gallery);
 $('.imageAdd').onclick=run(async()=>{const roleId=form.elements.roleId.value,file=$('.imageFile').files[0],description=$('.imageDescription').value.trim();if(!roleId)throw Error('请先选择角色');if(!file||file.size>2000000||!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('请选择 2 MB 以内的 PNG、JPEG、WebP 或 GIF');if(!description)throw Error('请填写图片说明，方便角色选择');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(file);});await api(`characters/${roleId}/qq-images`,'POST',{dataUrl,description});$('.imageFile').value='';$('.imageDescription').value='';await gallery();});
 async function load(){const [state,roles]=await Promise.all([api('qq'),api('characters')]);form.elements.roleId.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='请选择角色';form.elements.roleId.append(empty);for(const role of roles){const o=document.createElement('option');o.value=role.id;o.textContent=role.name;form.elements.roleId.append(o);}for(const [key,value] of Object.entries(state.config)){const input=form.elements[key];if(input)if(input.type==='checkbox')input.checked=value;else input.value=value;}form.elements.token.value='';form.elements.token.placeholder=state.tokenConfigured?'已保存，留空保留':'未配置';form.elements.clearToken.checked=false;show(state);await gallery();}
 button.onclick=run(async()=>{dialog.showModal();await load();});$('.close').onclick=()=>dialog.close();
 window.addEventListener('muse-open-qq-settings',()=>button.click());dialog.addEventListener('close',()=>window.dispatchEvent(new Event('muse-qq-settings-closed')));
 form.onsubmit=run(async()=>{const input={};for(const key of ['selfId','peerId','roleId','apiUrl','timeZone'])input[key]=form.elements[key].value.trim();for(const key of ['enabled','proactive','recoverOffline'])input[key]=form.elements[key].checked;for(const key of ['intervalMinutes','dailyLimit','quietStart','quietEnd'])input[key]=Number(form.elements[key].value);if(form.elements.clearToken.checked)input.token='';else if(form.elements.token.value)input.token=form.elements.token.value;show(await api('qq','PUT',input));form.elements.token.value='';form.elements.clearToken.checked=false;});
 $('.test').onclick=run(async()=>{await api('qq/test','POST',{});$('[role=status]').textContent='连接成功，桥接登录账号与 AI QQ 号一致。测试没有发送消息。';});
 $('.recover').onclick=run(async()=>show(await api('qq/recover','POST',{})));
 $('.nudge').onclick=run(async()=>{await api('qq/nudge','POST',{});show(await api('qq'));});$('.refresh').onclick=run(async()=>show(await api('qq')));
}
