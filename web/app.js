// SPDX-License-Identifier: GPL-3.0-or-later
import { parsePngCard, pngAvatar } from './png-card.js';
import { formatMessage } from './message-format.js';
import {installDshSettings} from './dsh-settings.js';
import {installLanSyncSettings} from './lan-sync-settings.js';
import {installQQSettings} from './qq-settings.js';
import {installQQRoleBinding} from './qq-role-binding.js';
const $=s=>document.querySelector(s);
const themeKey='muse:theme:v1',systemTheme=matchMedia('(prefers-color-scheme: dark)');
let themeMode='light';try{const saved=localStorage.getItem(themeKey);if(['light','dark','system'].includes(saved))themeMode=saved;}catch{}
function applyTheme(){document.documentElement.dataset.theme=themeMode==='system'?(systemTheme.matches?'dark':'light'):themeMode;}
applyTheme();systemTheme.addEventListener('change',()=>{if(themeMode==='system')applyTheme();});
const backupButton=document.createElement('button');backupButton.type='button';backupButton.className='settings';backupButton.textContent='完整备份与恢复';$('#settings').before(backupButton);
const backupDialog=document.createElement('dialog');backupDialog.innerHTML='<div class="dialogHead"><h2>完整备份与恢复</h2><button type="button" class="backupClose">关闭</button></div><p>包含角色、头像和背景、聊天及分支、记忆（含删除标记）、摘要和记忆追踪。API Key 与手机原始备份不包含在内。备份含私人对话，请妥善保管。</p><button type="button" class="backupDownload">导出完整备份</button><hr><label>选择完整备份 JSON（最多 63 MB）<input class="backupFile" type="file" accept=".json,application/json"></label><p>已有同 ID 的角色、聊天或整份角色记忆库会跳过，不覆盖也不逐条合并；只补入缺失数据。恢复过程中暂不可聊天或保存数据。</p><pre class="backupPreview"></pre><button type="button" class="backupRestore" disabled>确认恢复缺失数据</button><p role="status"></p>';document.body.append(backupDialog);
let fullBackup=null,backupWorking=false;
backupButton.onclick=()=>{fullBackup=null;backupDialog.querySelector('.backupFile').value='';backupDialog.querySelector('.backupPreview').textContent='';backupDialog.querySelector('[role=status]').textContent='';backupDialog.querySelector('.backupRestore').disabled=true;backupDialog.showModal();};
backupDialog.querySelector('.backupClose').onclick=()=>{if(!backupWorking)backupDialog.close();};backupDialog.addEventListener('cancel',e=>{if(backupWorking)e.preventDefault();});
function backupProgress(value){backupWorking=value;backupDialog.querySelectorAll('button,input').forEach(el=>el.disabled=value);if(!value)backupDialog.querySelector('.backupRestore').disabled=!fullBackup;}
function backupCounts(counts){return Object.entries({characters:'角色',chats:'聊天',memories:'角色记忆库'}).map(([k,label])=>`${label}：共 ${counts[k].total}，新增 ${counts[k].added}，跳过 ${counts[k].skipped}`).join('\n');}
backupDialog.querySelector('.backupDownload').onclick=async()=>{backupProgress(true);const status=backupDialog.querySelector('[role=status]');status.textContent='正在生成备份…';try{const response=await fetch('/api/backup');if(!response.ok)throw new Error((await response.json()).error);const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`muse-full-backup-${new Date().toISOString().slice(0,10)}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent='已发起下载，请查看浏览器下载列表。';}catch(e){status.textContent=e.message;}finally{backupProgress(false);}};
backupDialog.querySelector('.backupFile').onchange=async e=>{fullBackup=null;backupProgress(true);const status=backupDialog.querySelector('[role=status]');backupDialog.querySelector('.backupPreview').textContent='';try{const file=e.target.files[0];if(!file){status.textContent='';return;}if(file.size>63000000)throw new Error('备份超过 63 MB 限制');status.textContent='正在校验并预览…';const data=JSON.parse((await file.text()).replace(/^\uFEFF/,''));const preview=await api('backup','POST',{backup:data,preview:true});backupDialog.querySelector('.backupPreview').textContent=backupCounts(preview.counts);const added=Object.values(preview.counts).reduce((n,v)=>n+v.added,0);fullBackup=added?data:null;status.textContent=added?'确认后补入缺失数据。':'没有缺失数据，无需恢复。';}catch(e){status.textContent=e.message;}finally{backupProgress(false);}};
backupDialog.querySelector('.backupRestore').onclick=async()=>{if(!fullBackup||backupWorking)return;backupProgress(true);const status=backupDialog.querySelector('[role=status]');status.textContent='正在恢复…';try{const result=await api('backup','POST',{backup:fullBackup,preview:false});fullBackup=null;backupDialog.querySelector('.backupPreview').textContent=backupCounts(result.counts);status.textContent='恢复完成。';await refresh();}catch(e){status.textContent=e.message;}finally{backupProgress(false);}};
let roles=[], chats=[], selected=null, chat=null, editing=null, draft={}, imported=null, sending=false, liveText=null;
const entryHeader={'X-Muse-Entry':new URLSearchParams(location.search).get('embed')==='dsh'?'dsh':'web'};
async function api(path,method='GET',body) { const r=await fetch(`/api/${path}`,{method,headers:{...entryHeader,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}); const data=await r.json(); if(!r.ok) throw new Error(data.error); return data; }
function notice(s=''){ $('#notice').textContent=s; }
const draftPrefix='muse:draft:v1:',lastContextKey='muse:last-context:v1';
let draftContext=null,draftStorageWarning=false;
function readLocal(key){try{return localStorage.getItem(key);}catch{return null;}}
function writeLocal(key,value){
  try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}
  catch{if(!draftStorageWarning){draftStorageWarning=true;notice('浏览器未能保存草稿，请在离开页面前复制重要内容。');}}
}
function resizeComposer(){
  const input=$('#message'),list=$('#messages'),follow=list.scrollHeight-list.scrollTop-list.clientHeight<100;
  const limit=Math.max(96,Math.min(220,Math.floor(window.innerHeight*0.25)));
  const previousScroll=input.scrollTop;
  input.style.height='auto';
  input.style.height=`${Math.min(limit,Math.max(62,input.scrollHeight))}px`;
  input.style.overflowY=input.scrollHeight>limit?'auto':'hidden';
  input.scrollTop=previousScroll;
  if(follow)list.scrollTop=list.scrollHeight;
}
function saveDraft(){if(draftContext)writeLocal(draftPrefix+draftContext,$('#message').value||null);resizeComposer();}
function syncDraft(){
  const next=chat?`chat:${chat.id}`:roles.some(r=>r.id===selected)?`role:${selected}`:null;
  if(next!==draftContext){saveDraft();draftContext=next;$('#message').value=next?readLocal(draftPrefix+next)||'':'';}
  if(next)writeLocal(lastContextKey,next);
  resizeComposer();
}
function discardCurrentDraft(){if(draftContext)writeLocal(draftPrefix+draftContext,null);draftContext=null;$('#message').value='';}
$('#message').addEventListener('input',saveDraft);
window.addEventListener('pagehide',saveDraft);
window.addEventListener('resize',resizeComposer);
function guarded(fn){return async(...args)=>{try{await fn(...args);}catch(e){notice(e.message);}};}
function avatar(role){const e=document.createElement(role?.avatar?'img':'div');e.className='avatar';if(role?.avatar){e.src=role.avatar;e.alt='';}else e.textContent=role?.name?.slice(0,1)||'✦';return e;}
function messageShell(message,role,streaming=false){
  const user=message.role==='user';
  if(isGroup(chat)&&message.characterId)role=roles.find(r=>r.id===message.characterId)||{name:message.characterName||chat.participants.find(p=>p.characterId===message.characterId)?.name};
  const baseName=message.characterName||role?.name||chat?.characterName||'角色';
  const name=user?'你':isGroup(chat)?groupDisplayName(message.characterId,baseName):baseName;
  const row=document.createElement('div');row.className=`messageRow ${message.role}`;
  const portrait=avatar(user?{name:'你'}:role||{name});portrait.classList.add('messageAvatar');portrait.setAttribute('aria-hidden','true');
  const bubble=document.createElement('div');bubble.className=`bubble ${message.role}`;
  const meta=document.createElement('div');meta.className='messageMeta';
  const label=document.createElement('small');label.textContent=name;meta.append(label);
  const date=message.createdAt==null?null:new Date(message.createdAt);
  if(date&&!Number.isNaN(date.getTime())){
    const time=document.createElement('time'),now=new Date();time.dateTime=date.toISOString();time.title=date.toLocaleString('zh-CN');
    time.textContent=date.toDateString()===now.toDateString()?date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
    meta.append(time);
  }
  if(streaming){const status=document.createElement('span');status.className='generatingLabel';status.textContent='正在回复…';meta.append(status);}
  bubble.append(meta);row.append(portrait,bubble);return {row,bubble,label};
}

const isGroup=c=>c?.kind==='group';
function groupDisplayName(id,name){return chat?.participants?.filter(p=>p.name===name||(roles.find(r=>r.id===p.characterId)?.name===name)).length>1?name+' · '+id?.slice(0,4):name;}
const belongsTo=(c,id)=>isGroup(c)?c.participants.some(p=>p.characterId===id):c?.characterId===id;
const groupButton=document.createElement('button');groupButton.id='newGroupChat';groupButton.type='button';groupButton.textContent='＋ 多 AI 聊天室';$('#importChat').before(groupButton);
const groupDialog=document.createElement('dialog');groupDialog.id='groupChatDialog';groupDialog.setAttribute('aria-labelledby','groupChatTitle');
groupDialog.innerHTML='<form><div class="dialogHead"><h2 id="groupChatTitle">创建多 AI 聊天室</h2><button type="button" class="groupClose">取消</button></div><p class="muted">选择 2–8 个角色，按勾选顺序依次发言。每个角色使用自己的设定和记忆，共享本聊天室的对话。</p><label>聊天室名称<input class="groupName" maxlength="100" placeholder="例如：午后闲聊（可选）"></label><input class="groupSearch" type="search" placeholder="搜索角色" aria-label="搜索聊天室成员"><div class="groupRoleList"></div><p class="groupCount" role="status"></p><p class="groupError" role="alert"></p><button class="primary groupCreate" type="submit" disabled>创建聊天室</button></form>';document.body.append(groupDialog);
let groupSelection=new Set(),groupCreating=false;
function renderGroupChoices(){
 const visible=matchingRoles(groupDialog.querySelector('.groupSearch').value),list=groupDialog.querySelector('.groupRoleList');list.replaceChildren();
 for(const role of visible){const label=document.createElement('label');label.className='groupChoice';const check=document.createElement('input');check.type='checkbox';check.value=role.id;check.checked=groupSelection.has(role.id);check.disabled=!check.checked&&groupSelection.size>=8;const text=document.createElement('span');text.textContent=role.name;label.append(check,avatar(role),text);check.onchange=()=>{if(check.checked)groupSelection.add(role.id);else groupSelection.delete(role.id);renderGroupChoices();};list.append(label);}
 groupDialog.querySelector('.groupCount').textContent='已选择 '+groupSelection.size+' / 8 · '+[...groupSelection].map(id=>roles.find(r=>r.id===id)?.name).join(' → ');
 groupDialog.querySelector('.groupCreate').disabled=groupSelection.size<2||groupCreating;
 groupDialog.querySelector('.groupError').textContent=roles.length<2?'至少需要两个角色，请先创建或导入角色。':!visible.length?'没有匹配的角色。':'';
}
groupButton.onclick=guarded(async()=>{if(sending)return;roles=await api('characters');groupSelection=new Set();groupDialog.querySelector('form').reset();renderGroupChoices();groupDialog.showModal();groupDialog.querySelector('.groupName').focus();});
groupDialog.querySelector('.groupClose').onclick=()=>{if(!groupCreating)groupDialog.close();};groupDialog.addEventListener('cancel',e=>{if(groupCreating)e.preventDefault();});
groupDialog.querySelector('.groupSearch').oninput=renderGroupChoices;
groupDialog.querySelector('form').onsubmit=async e=>{
 e.preventDefault();if(groupCreating||groupSelection.size<2)return;groupCreating=true;groupDialog.querySelectorAll('input,button').forEach(el=>el.disabled=true);
 try{const title=groupDialog.querySelector('.groupName').value.trim();chat=await api('chats','POST',{characterIds:[...groupSelection],...(title?{title}:{})});selected=chat.characterId;groupDialog.close();$('#chooseChatDialog').close();$('#chatSearch').value='';chatsExpanded=true;notice('聊天室已创建，发送消息开始聊天');await refresh();$('#message').focus();}
 catch(error){groupDialog.querySelector('.groupError').textContent=error.message;}
 finally{groupCreating=false;groupDialog.querySelectorAll('input,button').forEach(el=>el.disabled=false);groupDialog.querySelector('.groupCreate').disabled=groupSelection.size<2;}
};
const groupBar=document.createElement('section');groupBar.id='groupBar';groupBar.hidden=true;groupBar.setAttribute('aria-label','聊天室成员与发言设置');
const groupMembers=document.createElement('div');groupMembers.className='groupMembers';
const groupReplyLabel=document.createElement('label');groupReplyLabel.textContent='本轮发言';const groupReply=document.createElement('select');groupReply.id='groupReply';groupReply.setAttribute('aria-label','本轮发言角色');groupReplyLabel.append(groupReply);
groupBar.append(groupMembers,groupReplyLabel);$('header').after(groupBar);
let groupReplyChat=null;
function renderGroupBar(running){
 groupBar.hidden=!isGroup(chat);groupButton.disabled=running;if(!isGroup(chat))return;
 const previous=groupReplyChat===chat.id?groupReply.value:'';groupReplyChat=chat.id;groupMembers.replaceChildren();
 const all=document.createElement('option');all.value='';all.textContent='全员依次回复';groupReply.replaceChildren(all);
 for(const p of chat.participants){const role=roles.find(r=>r.id===p.characterId),name=groupDisplayName(p.characterId,role?.name||p.name);
  const chip=document.createElement('button');chip.type='button';chip.className='groupMember';chip.disabled=running||!role;chip.title=role?'查看 '+name+' 的独立记忆':'角色已删除，可在回收站恢复';chip.append(avatar(role||{name}));const label=document.createElement('span');label.textContent=name+(role?'':'（已删除）');chip.append(label);chip.onclick=guarded(async()=>{const data=await api('characters/'+p.characterId+'/memories');memoryRoleId=p.characterId;$('#memorySearch').value='';$('#memoryStatus').textContent='';memoryData(data);$('#memoryDialog').showModal();});groupMembers.append(chip);
  const option=document.createElement('option');option.value=p.characterId;option.textContent='仅 '+name;option.disabled=!role;groupReply.append(option);
 }
 if([...groupReply.options].some(o=>o.value===previous&&!o.disabled))groupReply.value=previous;groupReply.disabled=running;
}
groupReply.onchange=()=>render();

function item(text,active,fn,role){const b=document.createElement('button');b.className=`listItem ${active?'active':''}`;if(role)b.append(avatar(role));const label=document.createElement('span');label.textContent=text;b.append(label);b.onclick=guarded(fn);b.disabled=sending;return b;}
const latestBar=document.createElement('div');latestBar.id='latestBar';
const latestButton=document.createElement('button');latestButton.type='button';latestButton.id='latestMessage';latestButton.textContent='回到最新消息 ↓';latestButton.hidden=true;
latestBar.append(latestButton);$('#messages').after(latestBar);
function updateLatestButton(){const list=$('#messages');latestButton.hidden=list.scrollHeight-list.scrollTop-list.clientHeight<100;}
latestButton.onclick=()=>{const list=$('#messages');list.scrollTop=list.scrollHeight;updateLatestButton();};
$('#messages').addEventListener('scroll',updateLatestButton,{passive:true});
new ResizeObserver(updateLatestButton).observe($('#messages'));
let renderedConversation;
const findButton=document.createElement('button');findButton.type='button';findButton.textContent='搜索消息';
const findBar=document.createElement('div');findBar.id='messageFindBar';findBar.hidden=true;
const findInput=document.createElement('input');findInput.type='search';findInput.maxLength=200;findInput.placeholder='搜索当前聊天';findInput.setAttribute('aria-label','当前聊天关键词');
const findCount=document.createElement('span');findCount.setAttribute('role','status');
const findPrevious=document.createElement('button'),findNext=document.createElement('button'),findClose=document.createElement('button');
for(const [button,label] of [[findPrevious,'上一条'],[findNext,'下一条'],[findClose,'关闭搜索']]){button.type='button';button.textContent=label;}
findBar.append(findInput,findCount,findPrevious,findNext,findClose);$('#messages').before(findBar);
let messageMatches=[],matchIndex=-1;
function showMessageMatch(jump=false){
  $('#messages').querySelectorAll('.searchCurrent').forEach(el=>el.classList.remove('searchCurrent'));
  const current=messageMatches[matchIndex];current?.classList.add('searchCurrent');
  findCount.textContent=!findInput.value.trim()?'输入关键词':messageMatches.length?`${matchIndex+1} / ${messageMatches.length} 条消息`:'没有匹配消息';
  findPrevious.disabled=findNext.disabled=!messageMatches.length;
  if(jump&&current){const list=$('#messages');list.scrollTop+=current.getBoundingClientRect().top-list.getBoundingClientRect().top-20;updateLatestButton();}
}
function searchMessages(reset=false,jump=false){
  const previous=messageMatches[matchIndex]?.dataset.messageId,q=findInput.value.trim().toLocaleLowerCase();
  const ids=new Set((chat?.messages||[]).filter(m=>q&&m.content.toLocaleLowerCase().includes(q)).map(m=>m.id));
  messageMatches=[...$('#messages').querySelectorAll('.bubble')].filter(el=>ids.has(el.dataset.messageId));
  matchIndex=reset?0:Math.max(0,messageMatches.findIndex(el=>el.dataset.messageId===previous));
  showMessageMatch(jump);
}
function closeMessageSearch(){findBar.hidden=true;findInput.value='';searchMessages(true);}
findButton.onclick=()=>{findBar.hidden=false;searchMessages();findInput.focus();};
findInput.oninput=()=>searchMessages(true,true);
function moveMessageMatch(step){if(!messageMatches.length)return;matchIndex=(matchIndex+step+messageMatches.length)%messageMatches.length;showMessageMatch(true);}
findPrevious.onclick=()=>moveMessageMatch(-1);findNext.onclick=()=>moveMessageMatch(1);
findClose.onclick=()=>{closeMessageSearch();$('#message').focus();};
findBar.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();findClose.click();}else if(e.key==='Enter'&&e.target===findInput&&!e.isComposing){e.preventDefault();moveMessageMatch(e.shiftKey?-1:1);}};
const roleMenu=document.createElement('div'),chatMenu=document.createElement('div');
for(const [menu,label,buttons] of [[roleMenu,'角色操作',[$('#memories'),$('#edit'),$('#deleteRole')]],[chatMenu,'聊天操作',[$('#renameChat'),$('#exportJson'),$('#exportMd'),findButton,$('#deleteChat')]]]){
  menu.className='listContextMenu';menu.role='menu';menu.setAttribute('aria-label',label);menu.hidden=true;
  for(const button of buttons){button.hidden=false;button.role='menuitem';menu.append(button);}document.body.append(menu);
  menu.addEventListener('click',async e=>{
    const button=e.target.closest('button'),target=listMenuTarget;if(!button||button.disabled||!target)return;
    e.stopImmediatePropagation();closeListMenu();
    try{
      if(button===exportRoleButton){await downloadRole(target.id);return;}
      if(button===pinRoleButton){const role=roles.find(r=>r.id===target.id);if(!role)return;await api(`characters/${role.id}`,'PUT',{pinned:!role.pinned});await refresh();notice(role.pinned?'已取消角色置顶':'角色已置顶');return;}
      if(target.kind==='role'){selected=target.id;chat=null;}else{chat=await api(`chats/${target.id}`);selected=chat.characterId;if(chat.generating){notice('该聊天正在生成，请稍后操作');return;}}
      render();await button.onclick?.();
    }catch(error){notice(error.message);}
  },true);
  menu.onkeydown=e=>{const items=[...menu.querySelectorAll('button:not(:disabled)')];if(e.key==='Escape'||e.key==='Tab'){if(e.key==='Escape')e.preventDefault();closeListMenu(true);}else if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const i=items.indexOf(document.activeElement),n=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[n]?.focus();}};
}
let listMenuTarget=null;
const exportRoleButton=document.createElement('button');exportRoleButton.type='button';exportRoleButton.role='menuitem';exportRoleButton.textContent='导出角色卡 JSON';roleMenu.insertBefore(exportRoleButton,$('#deleteRole'));
const pinRoleButton=document.createElement('button');pinRoleButton.type='button';pinRoleButton.role='menuitem';pinRoleButton.textContent='置顶角色';roleMenu.prepend(pinRoleButton);
async function downloadRole(id){
  const response=await fetch(`/api/characters/${id}/export`);if(!response.ok)throw new Error((await response.json()).error);
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`muse-character-${id}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  notice('已发起角色卡下载。包含角色设定、头像和背景，不包含聊天或记忆；可通过“导入角色卡”恢复为新角色。');
}
const parentChatButton=document.createElement('button'),branchesButton=document.createElement('button');
const summaryButton=document.createElement('button');summaryButton.type='button';summaryButton.role='menuitem';summaryButton.textContent='长对话摘要';chatMenu.append(summaryButton);
const summaryDialog=document.createElement('dialog');summaryDialog.id='summaryDialog';summaryDialog.innerHTML='<div class="dialogHead"><h2>长对话摘要</h2><button type="button" class="summaryClose">关闭</button></div><p>达到 40 条消息后自动整理较早对话，至少保留最近 20 条原文。生成摘要会额外调用 DeepSeek；原聊天完整保留。摘要可能遗漏细节，可编辑修正。关闭后回复使用完整原文。</p><label class="autoMemoryToggle"><input type="checkbox" class="summaryEnabled">启用自动摘要并在回复中使用</label><p class="summaryInfo"></p><label>摘要内容<textarea class="summaryText" rows="9" maxlength="8000"></textarea></label><div class="actions"><button type="button" class="summarySave">保存编辑</button><button type="button" class="summaryGenerate">生成／重新生成摘要</button></div><p role="status"></p>';document.body.append(summaryDialog);
let summaryChat=null,summaryBusy=false;
function showSummary(data){summaryChat=data;summaryDialog.querySelector('.summaryEnabled').checked=data.summaryEnabled!==false;summaryDialog.querySelector('.summaryText').value=data.summary?.text||'';summaryDialog.querySelector('.summarySave').disabled=!data.summary;summaryDialog.querySelector('.summaryInfo').textContent=(data.summary?`已整理前 ${data.summary.coveredCount} 条，更新于 ${new Date(data.summary.updatedAt).toLocaleString('zh-CN')}${data.summary.edited?' · 已人工编辑':''}`:'尚未生成摘要。')+(data.summaryError?' '+data.summaryError:'');}
summaryButton.onclick=()=>{showSummary(chat);summaryDialog.querySelector('[role=status]').textContent='';summaryDialog.showModal();};
summaryDialog.querySelector('.summaryClose').onclick=()=>{if(!summaryBusy)summaryDialog.close();};summaryDialog.addEventListener('cancel',e=>{if(summaryBusy)e.preventDefault();});
async function updateSummary(method,body){
  if(summaryBusy)return;summaryBusy=true;summaryDialog.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);summaryDialog.querySelector('[role=status]').textContent=method==='POST'?'正在整理，请稍候…':'正在保存…';
  try{const data=await api(`chats/${summaryChat.id}/summary`,method,{...body,updatedAt:summaryChat.updatedAt});if(chat?.id===data.id)chat=data;showSummary(data);summaryDialog.querySelector('[role=status]').textContent='已保存';await refresh();}
  catch(e){summaryDialog.querySelector('[role=status]').textContent=e.message;summaryDialog.querySelector('.summaryEnabled').checked=summaryChat.summaryEnabled!==false;}
  finally{summaryBusy=false;summaryDialog.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);summaryDialog.querySelector('.summarySave').disabled=!summaryChat.summary;}
}
summaryDialog.querySelector('.summaryEnabled').onchange=e=>updateSummary('PUT',{enabled:e.target.checked});
summaryDialog.querySelector('.summarySave').onclick=()=>updateSummary('PUT',{text:summaryDialog.querySelector('.summaryText').value});
summaryDialog.querySelector('.summaryGenerate').onclick=()=>updateSummary('POST',{});
const pinChatButton=document.createElement('button'),archiveChatButton=document.createElement('button');
for(const button of [pinChatButton,archiveChatButton]){button.type='button';button.role='menuitem';chatMenu.append(button);}
function prepareChatMenu(id){const target=chats.find(c=>c.id===id);parentChatButton.disabled=!target?.parentChatId;pinChatButton.textContent=target?.pinned?'取消置顶':'置顶聊天';archiveChatButton.textContent=target?.archived?'恢复到聊天列表':'归档聊天';}
async function organizeChat(key){
  const next=!chat[key];chat=await api(`chats/${chat.id}/organization`,'PUT',{updatedAt:chat.updatedAt,[key]:next});
  if(key==='archived'){notice(next?'聊天已归档，可切换到已归档列表查看。':'聊天已恢复。');chat=null;}
  else notice(next?'聊天已置顶':'已取消置顶');
  await refresh();
}
pinChatButton.onclick=guarded(()=>organizeChat('pinned'));archiveChatButton.onclick=guarded(()=>organizeChat('archived'));
for(const [button,label] of [[parentChatButton,'返回原聊天'],[branchesButton,'查看相关分支']]){button.type='button';button.role='menuitem';button.textContent=label;chatMenu.append(button);}
const branchesDialog=document.createElement('dialog');branchesDialog.innerHTML='<div class="dialogHead"><h2>相关聊天分支</h2><button type="button">关闭</button></div><p class="muted">显示当前聊天、原聊天及直接产生的分支。切换不会修改消息。</p><div class="branchList"></div><p role="status"></p>';document.body.append(branchesDialog);
branchesDialog.querySelector('button').onclick=()=>branchesDialog.close();
parentChatButton.onclick=guarded(async()=>{
  if(!chat?.parentChatId){notice('这条聊天没有记录来源。');return;}
  let parent;try{parent=await api(`chats/${chat.parentChatId}`);}catch{notice('无法打开原聊天，可能已被删除；当前分支仍可使用。');return;}
  chat=parent;selected=parent.characterId;notice();await refresh();
});
branchesButton.onclick=guarded(async()=>{
  const current=chat,all=await api('chats'),list=branchesDialog.querySelector('.branchList');list.replaceChildren();
  const related=all.filter(c=>c.id===current.id||c.id===current.parentChatId||c.parentChatId===current.id);
  for(const c of related){const kind=c.id===current.id?'当前聊天':c.id===current.parentChatId?'原聊天':c.branchAction==='regenerate'?'重新生成分支':'编辑分支';
    const button=item(`${kind} · ${c.title}`,c.id===current.id,async()=>{chat=await api(`chats/${c.id}`);selected=chat.characterId;branchesDialog.close();notice();await refresh();});button.title=c.title;list.append(button);
  }
  branchesDialog.querySelector('[role=status]').textContent=current.parentChatId&&!all.some(c=>c.id===current.parentChatId)?'原聊天已删除，当前分支仍可独立使用。':!current.parentChatId?'此聊天没有记录来源。旧版生成的分支无法自动追溯；新建分支将记录来源。':'';
  branchesDialog.showModal();
});
function closeListMenu(focus=false){const target=listMenuTarget;roleMenu.hidden=chatMenu.hidden=true;target?.element.classList.remove('contextSelected');listMenuTarget=null;if(focus&&target?.element.isConnected)target.element.focus({preventScroll:true});}
function bindListMenu(element,kind,id){
  if(kind==='role'){
    const prepare=()=>{pinRoleButton.textContent=roles.find(r=>r.id===id)?.pinned?'取消角色置顶':'置顶角色';};
    element.addEventListener('contextmenu',prepare);element.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey)prepare();});
  }
  element.setAttribute('aria-haspopup','menu');
  element.addEventListener('contextmenu',()=>{if(kind==='chat')prepareChatMenu(id);});
  element.addEventListener('keydown',e=>{if(kind==='chat'&&(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey))prepareChatMenu(id);});
  const open=e=>{if(sending||chat?.generating)return;e.preventDefault();closeMessageMenu();closeListMenu();const menu=kind==='role'?roleMenu:chatMenu;listMenuTarget={element,kind,id};element.classList.add('contextSelected');menu.hidden=false;const rect=element.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(e.clientX||rect.right,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(e.clientY||rect.top,innerHeight-menu.offsetHeight-8))}px`;menu.querySelector('button')?.focus({preventScroll:true});};
  element.oncontextmenu=open;element.onkeydown=e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey)open(e);};
}
document.addEventListener('pointerdown',e=>{if(!roleMenu.contains(e.target)&&!chatMenu.contains(e.target))closeListMenu();});
document.addEventListener('scroll',()=>closeListMenu(),true);window.addEventListener('resize',()=>closeListMenu());window.addEventListener('blur',()=>closeListMenu());
const messageMenu=document.createElement('div');messageMenu.id='messageMenu';messageMenu.role='menu';messageMenu.setAttribute('aria-label','消息操作');messageMenu.hidden=true;
const copyMessageItem=document.createElement('button');copyMessageItem.type='button';copyMessageItem.role='menuitem';copyMessageItem.textContent='复制消息';messageMenu.append(copyMessageItem);
const quoteMessageItem=document.createElement('button');quoteMessageItem.type='button';quoteMessageItem.role='menuitem';quoteMessageItem.textContent='引用回复';messageMenu.append(quoteMessageItem);
const saveMemoryItem=document.createElement('button');saveMemoryItem.type='button';saveMemoryItem.role='menuitem';saveMemoryItem.textContent='存为记忆';messageMenu.append(saveMemoryItem);document.body.append(messageMenu);
let menuMessage=null;
const favoriteItem=document.createElement('button');favoriteItem.type='button';favoriteItem.role='menuitem';messageMenu.append(favoriteItem);
favoriteItem.onclick=guarded(async()=>{
  const target=menuMessage;closeMessageMenu(true);if(!target||favoriteItem.disabled)return;
  const enabled=!chat?.messages.find(m=>m.id===target.messageId)?.favoriteAt;
  const saved=await api(`chats/${target.chatId}/favorite`,'PUT',{messageId:target.messageId,updatedAt:target.updatedAt,enabled});
  if(chat?.id===saved.id){chat=saved;render();}notice(enabled?'已收藏，可在侧栏“消息收藏”查看':'已取消收藏');
});
const favoritesButton=document.createElement('button');favoritesButton.type='button';favoritesButton.className='settings';favoritesButton.textContent='☆ 消息收藏';$('#settings').before(favoritesButton);
const favoritesDialog=document.createElement('dialog');favoritesDialog.id='favoritesDialog';favoritesDialog.setAttribute('aria-labelledby','favoritesTitle');
favoritesDialog.innerHTML='<div class="dialogHead"><h2 id="favoritesTitle">消息收藏</h2><button type="button" class="favoritesClose">关闭</button></div><p class="muted">右键消息可收藏或取消。收藏跟随消息的当前回复版本；新分支不重复收藏。回收站中的聊天暂不显示，恢复后重新显示。收藏随完整备份和 JSON 聊天备份保存。</p><label>搜索收藏<input type="search" maxlength="200" placeholder="消息内容、角色或聊天名称"></label><p role="status"></p><div class="favoriteRows"></div><div class="actions"><button class="favoritesPrev" type="button">上一页</button><button class="favoritesNext" type="button">下一页</button></div>';
document.body.append(favoritesDialog);let favoriteOffset=0,favoriteRequest=0,favoriteTimer;
favoritesDialog.querySelector('.favoritesClose').onclick=()=>favoritesDialog.close();
favoritesDialog.addEventListener('close',()=>{favoriteRequest++;clearTimeout(favoriteTimer);});
async function loadFavorites(){
  const request=++favoriteRequest,status=favoritesDialog.querySelector('[role=status]'),rows=favoritesDialog.querySelector('.favoriteRows');
  rows.replaceChildren();status.textContent='正在读取收藏…';favoritesDialog.querySelectorAll('.actions button').forEach(b=>b.disabled=true);
  try{
    const data=await api(`favorites?q=${encodeURIComponent(favoritesDialog.querySelector('input').value)}&offset=${favoriteOffset}`);if(request!==favoriteRequest)return;
    if(!data.items.length&&favoriteOffset>0){favoriteOffset=Math.max(0,favoriteOffset-50);return loadFavorites();}
    status.textContent=data.total?`共 ${data.total} 条 · 第 ${Math.floor(favoriteOffset/50)+1} 页`:'没有匹配的收藏。可在聊天消息上右键，选择“收藏消息”。';
    favoritesDialog.querySelector('.favoritesPrev').disabled=favoriteOffset===0;favoritesDialog.querySelector('.favoritesNext').disabled=favoriteOffset+50>=data.total;
    for(const item of data.items){
      const box=document.createElement('article');box.className='memoryItem';const title=document.createElement('strong'),meta=document.createElement('p'),content=document.createElement('p'),actions=document.createElement('div');actions.className='actions';
      title.textContent=`${item.characterName} · ${item.title}`;meta.className='muted';meta.textContent=`${item.role==='user'?'你':item.characterName} · 收藏于 ${new Date(item.favoriteAt).toLocaleString('zh-CN')}`;content.textContent=item.content;content.style.whiteSpace='pre-wrap';content.style.overflowWrap='anywhere';
      const open=document.createElement('button'),remove=document.createElement('button');open.type=remove.type='button';open.textContent='跳转原消息';remove.textContent='取消收藏';
      open.onclick=async()=>{try{if(sending||chat?.generating)throw Error('请等待当前回复结束再跳转');open.disabled=true;const next=await api(`chats/${item.chatId}`);saveDraft();chat=next;selected=next.characterId;favoritesDialog.close();render();const target=[...$('#messages').querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===item.messageId);if(target){target.classList.add('searchCurrent');target.scrollIntoView({block:'center'});target.focus({preventScroll:true});}else notice('原消息已不存在');}catch(e){status.textContent=e.message;}finally{open.disabled=false;}};
      remove.onclick=async()=>{remove.disabled=true;try{const saved=await api(`chats/${item.chatId}/favorite`,'PUT',{messageId:item.messageId,updatedAt:item.updatedAt,enabled:false});if(chat?.id===saved.id){chat=saved;render();}await loadFavorites();}catch(e){status.textContent=e.message;remove.disabled=false;}};
      actions.append(open,remove);box.append(title,meta,content,actions);rows.append(box);
    }
  }catch(e){if(request===favoriteRequest)status.textContent=e.message;}
}
favoritesButton.onclick=()=>{favoriteOffset=0;favoritesDialog.querySelector('input').value='';favoritesDialog.showModal();loadFavorites();};
favoritesDialog.querySelector('input').oninput=()=>{favoriteOffset=0;favoriteRequest++;clearTimeout(favoriteTimer);favoriteTimer=setTimeout(loadFavorites,180);};
favoritesDialog.querySelector('.favoritesPrev').onclick=()=>{favoriteOffset=Math.max(0,favoriteOffset-50);loadFavorites();};
favoritesDialog.querySelector('.favoritesNext').onclick=()=>{favoriteOffset+=50;loadFavorites();};
const memoryTraceItem=document.createElement('button');memoryTraceItem.type='button';memoryTraceItem.role='menuitem';memoryTraceItem.textContent='查看本次记忆';messageMenu.append(memoryTraceItem);
const traceDialog=document.createElement('dialog');traceDialog.id='memoryTraceDialog';traceDialog.innerHTML='<div class="dialogHead"><h2>本次回复的记忆</h2><button type="button">关闭</button></div><p class="muted">这里记录生成时放入请求的记忆，不代表模型一定采用。后续编辑或删除记忆不会改变这份历史快照。</p><p class="traceSummary" role="status"></p><div class="traceRecords"></div>';document.body.append(traceDialog);traceDialog.querySelector('button').onclick=()=>traceDialog.close();
memoryTraceItem.onclick=()=>{
  const target=menuMessage;closeMessageMenu(true);if(!target)return;
  const message=chat?.messages.find(m=>m.id===target.messageId),trace=message?.memoryTrace,list=traceDialog.querySelector('.traceRecords');list.replaceChildren();
  traceDialog.querySelector('.traceSummary').textContent=trace?`${new Date(trace.capturedAt).toLocaleString('zh-CN')} · 带入 ${trace.records.length} 条 · 已过期未带入 ${trace.expired} 条 · 超出长度预算未带入 ${trace.budgetSkipped} 条`:'这条消息没有记忆追踪记录（旧消息、开场白、导入或人工编辑的回复）。不能据此判断当时是否使用过记忆。';
  if(trace?.selection)traceDialog.querySelector('.traceSummary').textContent+=` · ${trace.selection==='topic'?'按当前话题检索':'未匹配话题，使用基础记忆'} · 检索未选入 ${trace.unselected} 条`;
  for(const record of trace?.records||[]){const box=document.createElement('article');box.className='memoryItem';const p=document.createElement('p');p.textContent=record.text;const meta=document.createElement('small');meta.className='muted';meta.textContent=`来源：${({local:'本地',automatic:'自动记忆',backup:'备份恢复',phone:'手机导入'})[record.source]||record.source} · 版本 ${record.revision}`+(record.selectionReason?` · ${record.selectionReason}`:'');box.append(p,meta);list.append(box);}
  if(trace?.history?.length){traceDialog.querySelector('.traceSummary').textContent+=` · 历史原文 ${trace.history.length} 处`;for(const hit of trace.history)list.append(historyResult(hit,target.roleId,traceDialog));}
  if(trace&&!trace.records.length&&!trace.history?.length)list.textContent='本次请求没有带入记忆库条目；聊天历史和角色设定仍可能提供上下文。';
  traceDialog.showModal();
};
const editMessageItem=document.createElement('button'),regenerateItem=document.createElement('button');
for(const [button,label] of [[editMessageItem,'编辑消息'],[regenerateItem,'重新生成']]){button.type='button';button.role='menuitem';button.textContent=label;messageMenu.append(button);}
const revisionDialog=document.createElement('dialog');
revisionDialog.innerHTML='<form><div class="dialogHead"><h2>编辑消息</h2><button type="button">取消</button></div><p>保存为新的聊天分支，保留原聊天。新分支只保留到这条消息；编辑用户消息后将重新生成回答。已保存的记忆不会自动修改。</p><label>消息内容<textarea required maxlength="30000" rows="10"></textarea></label><p role="alert"></p><button type="submit">保存并继续</button></form>';
document.body.append(revisionDialog);
let revisionTarget=null;
revisionDialog.querySelector('button').onclick=()=>revisionDialog.close();
async function createRevision(target,action,content){
  const branch=await api(`chats/${target.chatId}/revision`,'POST',{messageId:target.messageId,updatedAt:target.updatedAt,action,content});
  chat=branch;selected=branch.characterId;revisionDialog.close();await refresh();
  if(branch.messages.at(-1)?.role==='user')await send(true);
}
editMessageItem.onclick=()=>{revisionTarget=menuMessage;closeMessageMenu(true);if(!revisionTarget||editMessageItem.disabled)return;revisionDialog.querySelector('textarea').value=revisionTarget.content;revisionDialog.querySelector('[role=alert]').textContent='';revisionDialog.showModal();};
revisionDialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=revisionDialog.querySelector('[type=submit]');button.disabled=true;try{await createRevision(revisionTarget,'edit',revisionDialog.querySelector('textarea').value);}catch(error){revisionDialog.querySelector('[role=alert]').textContent=error.message;}finally{button.disabled=false;}};
regenerateItem.onclick=guarded(async()=>{const target=menuMessage;closeMessageMenu(true);if(!target||regenerateItem.disabled)return;if(chat?.messages.at(-1)?.id===target.messageId)await send(false,target);else await createRevision(target,'regenerate');});
function closeMessageMenu(restoreFocus=false){
  const previous=menuMessage;messageMenu.hidden=true;menuMessage=null;previous?.element.classList.remove('contextSelected');
  if(restoreFocus&&previous?.element.isConnected)previous.element.focus({preventScroll:true});
}
function openMessageMenu(element,roleId,content,x,y,author){
  closeListMenu();
  closeMessageMenu();menuMessage={element,roleId,content,author,chatId:chat?.id,updatedAt:chat?.updatedAt,messageId:element.dataset.messageId};element.classList.add('contextSelected');messageMenu.hidden=false;
  const index=chat?.messages.findIndex(m=>m.id===menuMessage.messageId)??-1;
  favoriteItem.textContent=chat?.messages[index]?.favoriteAt?'取消收藏':'收藏消息';favoriteItem.disabled=sending||!!chat?.generating||index<0;
  memoryTraceItem.disabled=index<0||chat.messages[index]?.role!=='assistant';
  editMessageItem.disabled=(!roleId&&!isGroup(chat))||sending||!!chat?.generating||index<0;
  regenerateItem.disabled=isGroup(chat)||editMessageItem.disabled||chat.messages[index]?.role!=='assistant'||chat.messages[index-1]?.role!=='user';
  saveMemoryItem.disabled=!roleId||sending||!!chat?.generating;
  quoteMessageItem.disabled=$('#message').disabled;
  messageMenu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-messageMenu.offsetWidth-8))}px`;
  messageMenu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-messageMenu.offsetHeight-8))}px`;
  copyMessageItem.focus({preventScroll:true});
}
copyMessageItem.onclick=async()=>{
  const target=menuMessage;closeMessageMenu(true);if(!target)return;
  try{await navigator.clipboard.writeText(target.content);notice('消息已复制');}
  catch{notice('无法访问剪贴板，请选中消息文字后按 Ctrl+C 复制。');}
};
quoteMessageItem.onclick=()=>{
  const target=menuMessage;closeMessageMenu(true);const input=$('#message');if(!target||input.disabled)return;
  const quote=`引用 ${target.author.replace(/[\r\n]/g,' ')} 的消息：\n${target.content.split('\n').map(line=>'> '+line).join('\n')}\n\n`;
  if(quote.length+input.value.length>30000){notice('引用与草稿合计超过 30000 字，请先复制需要引用的片段。');return;}
  input.value=quote+input.value;input.focus();input.setSelectionRange(input.value.length,input.value.length);input.scrollTop=input.scrollHeight;
  saveDraft();
  notice('引用已放入输入框，可编辑后发送；原有草稿已保留。');
};
saveMemoryItem.onclick=()=>{const target=menuMessage;closeMessageMenu(true);if(!target||sending||chat?.generating||!roles.some(r=>r.id===target.roleId))return;memoryRoleId=target.roleId;editMemory(null,target.content,{sourceChatId:target.chatId,sourceMessageId:target.messageId});};
document.addEventListener('pointerdown',e=>{if(!messageMenu.contains(e.target))closeMessageMenu();});
document.addEventListener('keydown',e=>{
  if(messageMenu.hidden)return;
  if(e.key==='Escape'){e.preventDefault();closeMessageMenu(true);}
  else if(e.key==='Tab')closeMessageMenu(true);
  else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();const items=[...messageMenu.querySelectorAll('button')].filter(item=>!item.disabled),index=items.indexOf(document.activeElement);
    const next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
    items[next].focus({preventScroll:true});
  }
});
document.addEventListener('scroll',()=>closeMessageMenu(),true);
window.addEventListener('resize',()=>closeMessageMenu());window.addEventListener('blur',()=>closeMessageMenu());
async function refresh(){[roles,chats]=await Promise.all([api('characters'),api('chats?q='+encodeURIComponent($('#chatSearch').value.trim()))]);render();}
let searchVersion=0,searchTimer;
let showArchived=false;
let rolesExpanded=false,chatsExpanded=false;
let chatListKind=readLocal('muse:chat-list-kind:v1')==='group'?'group':'single';
const chatTabs=document.createElement('nav');chatTabs.id='chatTabs';chatTabs.setAttribute('aria-label','对话分类');
for(const [kind,label] of [['single','单独聊天'],['group','聊天室']]){
 const tab=document.createElement('button');tab.type='button';tab.dataset.kind=kind;tab.textContent=label;
 tab.onclick=guarded(async()=>{if(sending||chat?.generating||kind===chatListKind)return;saveDraft();chat=null;selected=null;chatListKind=kind;writeLocal('muse:chat-list-kind:v1',kind);writeLocal(lastContextKey,null);showArchived=false;chatsExpanded=true;$('#chatSearch').value='';++searchVersion;clearTimeout(searchTimer);archiveToggle.textContent='查看已归档';archiveToggle.setAttribute('aria-pressed','false');await refresh();});chatTabs.append(tab);
}
groupButton.before(chatTabs);
const singleChatButton=document.createElement('button');singleChatButton.id='newSingleChat';singleChatButton.type='button';singleChatButton.textContent='＋ 单独聊天';singleChatButton.onclick=()=>$('#newChat').click();groupButton.before(singleChatButton);
function appendListToggle(container,total,expanded,label,toggle){
  if(total<=3)return;
  const button=document.createElement('button');button.type='button';button.className='listExpand';button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-controls',container.id);
  button.textContent=expanded?`收起${label}`:`展开更多${label}（${total-3}）`;button.onclick=()=>{closeListMenu();toggle();};container.append(button);
}
const archiveToggle=document.createElement('button');archiveToggle.type='button';archiveToggle.id='archiveToggle';archiveToggle.textContent='查看已归档';archiveToggle.setAttribute('aria-pressed','false');$('#chatSearch').before(archiveToggle);
archiveToggle.onclick=()=>{showArchived=!showArchived;archiveToggle.textContent=showArchived?'返回聊天列表':'查看已归档';archiveToggle.setAttribute('aria-pressed',String(showArchived));closeListMenu();renderChats();};
$('#chatSearch').oninput=()=>{clearTimeout(searchTimer);const version=++searchVersion;searchTimer=setTimeout(guarded(async()=>{const results=await api('chats?q='+encodeURIComponent($('#chatSearch').value.trim()));if(version!==searchVersion)return;chats=results;renderChats();}),200);};
function renderChats(){
  for(const tab of chatTabs.children){tab.setAttribute('aria-pressed',String(tab.dataset.kind===chatListKind));tab.disabled=!!(sending||chat?.generating);}
  groupButton.hidden=chatListKind!=='group';singleChatButton.hidden=chatListKind!=='single';singleChatButton.disabled=!!(sending||chat?.generating);
  $('#chatSearch').placeholder=chatListKind==='group'?'搜索聊天室、成员或消息':'搜索单独聊天';
  const visibleChats=chats.filter(c=>(isGroup(c)?'group':'single')===chatListKind&&!!c.archived===showArchived).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.updatedAt-a.updatedAt);
  const searching=!!$('#chatSearch').value.trim(),shown=searching||chatsExpanded?visibleChats:visibleChats.slice(0,3);
  $('#chats').replaceChildren(...shown.map(c=>{
    const button=item('',chat?.id===c.id,async()=>{chat=await api(`chats/${c.id}`);selected=chat.characterId;notice();render();});button.classList.add('chatItem');button.replaceChildren();
    const name=document.createElement('strong');name.textContent=(c.pinned?'置顶 · ':'')+(c.parentChatId?'↳ ':'')+(c.title||c.characterName);
    const detail=document.createElement('small');detail.textContent=`${isGroup(c)?'聊天室 · '+c.participants.map(p=>p.name).join('、'):c.characterName} · ${c.messageCount} 条 · ${new Date(c.updatedAt).toLocaleDateString('zh-CN')}`+(isGroup(c)||roles.some(r=>r.id===c.characterId)?'':' · 角色已删除');
    button.append(name,detail);if(c.excerpt){const snippet=document.createElement('small');snippet.textContent=c.excerpt;button.append(snippet);}button.title=name.textContent;bindListMenu(button,'chat',c.id);return button;
  }));
  if(!visibleChats.length){const p=document.createElement('p');p.className='muted';p.textContent=$('#chatSearch').value?'当前分类没有匹配结果':showArchived?'当前分类暂无已归档记录':chatListKind==='group'?'还没有聊天室，邀请几个角色一起聊吧。':'还没有单独聊天，选一个角色开始吧。';$('#chats').append(p);}
  if(!searching)appendListToggle($('#chats'),visibleChats.length,chatsExpanded,chatListKind==='group'?'聊天室':'单独聊天',()=>{chatsExpanded=!chatsExpanded;renderChats();$('#chats .listExpand')?.focus();});
}
const roleSearch=document.createElement('input');roleSearch.type='search';roleSearch.placeholder='搜索角色名称';roleSearch.setAttribute('aria-label','搜索角色');$('#roles').before(roleSearch);
function matchingRoles(query){const term=query.trim().normalize('NFKC').toLocaleLowerCase();return roles.filter(role=>role.name.normalize('NFKC').toLocaleLowerCase().includes(term)).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));}
function renderRoleLibrary(){
  const visible=matchingRoles(roleSearch.value);
  const searching=!!roleSearch.value.trim(),shown=searching||rolesExpanded?visible:visible.slice(0,3);
  $('#roles').replaceChildren(...shown.map(r=>{const button=item((r.pinned?'置顶 · ':'')+r.name,r.id===selected,async()=>{selected=r.id;chat=null;notice();render();},r);bindListMenu(button,'role',r.id);return button;}));
  if(!visible.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=roles.length?'没有匹配的角色，请修改或清空搜索。':'暂无角色，请创建或导入角色卡。';$('#roles').append(empty);}
  if(!searching)appendListToggle($('#roles'),visible.length,rolesExpanded,'角色',()=>{rolesExpanded=!rolesExpanded;renderRoleLibrary();$('#roles .listExpand')?.focus();});
}
roleSearch.oninput=()=>{closeListMenu();renderRoleLibrary();};
function render(){
  const list=$('#messages'),previousTop=list.scrollTop,conversation=chat?.id||selected;
  if(conversation&&renderedConversation!==conversation){chatListKind=isGroup(chat)?'group':'single';writeLocal('muse:chat-list-kind:v1',chatListKind);}
  if(chat&&renderedConversation!==conversation){showArchived=!!chat.archived;archiveToggle.textContent=showArchived?'返回聊天列表':'查看已归档';archiveToggle.setAttribute('aria-pressed',String(showArchived));}
  const follow=renderedConversation!==conversation||list.scrollHeight-list.scrollTop-list.clientHeight<100;
  if(renderedConversation!==conversation)closeMessageSearch();
  closeListMenu();
  renderedConversation=conversation;
  closeMessageMenu();
  syncDraft();
  const running=sending||chat?.generating;
  const role=roles.find(r=>r.id===selected);
  renderGroupBar(running);
  renderRoleLibrary();
  renderChats();
  $('#title').textContent=isGroup(chat)?chat.title:role?.name||chat?.characterName||'你的故事，从这里开始';
  $('#subtitle').textContent=role?`${role.model} · ${chat?'聊天已保存到本机':'准备好开启一段新对话了吗？'}`:chat?'角色已删除 · 历史聊天只读':'选择一个角色，开启属于你们的对话。';
  for(const id of ['edit','newChat','deleteRole','memories']) {$('#'+id).hidden=false;$('#'+id).disabled=running;}
  for(const id of ['edit','deleteRole','memories'])$('#'+id).hidden=chatListKind==='group';
  $('#newChat').textContent=chatListKind==='group'?'新聊天室':'新单独聊天';
  for(const id of ['create','import','importChat'])$('#'+id).disabled=running;
  $('#deleteChat').hidden=false;$('#deleteChat').disabled=running;
  for(const id of ['renameChat','exportJson','exportMd']){$('#'+id).hidden=false;$('#'+id).disabled=running;}
  if(chat)$('#subtitle').textContent=`${chat.title} · ${role?.model||'角色已删除，只读'} · 已本地保存`;
  if(isGroup(chat))$('#subtitle').textContent=`多 AI 聊天室 · ${chat.participants.length} 位角色 · 独立人格与记忆 · 已本地保存`;
  if(!chat&&!selected&&chatListKind==='group'){$('#title').textContent='多 AI 聊天室';$('#subtitle').textContent='邀请多个角色，各自带着人格与记忆，一起聊聊。';}
  $('main').style.backgroundImage=!isGroup(chat)&&role?.background?`url("${role.background}")`:'';
  const messages=chat?.messages||[];
  $('#messages').replaceChildren();
  if(!messages.length){const box=document.createElement('div');box.className='welcome';box.textContent=isGroup(chat)?'✦ 成员已就位，向大家打个招呼吧':role?`✦ 与 ${role.name} 开启新对话`:chatListKind==='group'?'✦ 新建或选择一个聊天室':'✦ 创建角色，开始你的故事';$('#messages').append(box);}
  for(const m of messages){
    const {row,bubble:b,label}=messageShell(m,role);b.dataset.messageId=m.id;
    if(m.favoriteAt){const marker=document.createElement('span');marker.textContent=' ★';marker.title='已收藏';marker.setAttribute('aria-label','已收藏');label.append(marker);}
    const text=formatMessage(m.originalContent??m.content);b.append(text);
    if(m.images?.length){const images=document.createElement('div');images.className='qqMessageImages';for(const image of m.images){if(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl||'')){const img=document.createElement('img');img.src=image.dataUrl;img.alt=image.description||'QQ 聊天图片';img.loading='lazy';img.title=image.description||'QQ 聊天图片';images.append(img);}if(image.error){const error=document.createElement('small');error.textContent=image.error;images.append(error);}}b.append(images);}
    if(m.versions?.length&&!isGroup(chat)){
      const controls=document.createElement('div');controls.className='replyVersions';
      const previous=document.createElement('button'),next=document.createElement('button'),count=document.createElement('span');previous.type=next.type='button';previous.textContent='‹';next.textContent='›';previous.setAttribute('aria-label','上一个回复版本');next.setAttribute('aria-label','下一个回复版本');count.textContent=`${m.activeVersion+1} / ${m.versions.length}`;
      const locked=running||m.id!==messages.at(-1)?.id;previous.disabled=locked||m.activeVersion===0;next.disabled=locked||m.activeVersion===m.versions.length-1;
      controls.title=locked?'后面已有消息或正在生成，暂不可切换版本':'选择的版本将用于后续聊天';
      for(const [button,step] of [[previous,-1],[next,1]])button.onclick=guarded(async()=>{previous.disabled=next.disabled=true;try{chat=await api(`chats/${chat.id}/version`,'PUT',{messageId:m.id,index:m.activeVersion+step,updatedAt:chat.updatedAt});notice();await refresh();}catch(e){render();throw e;}});
      controls.append(previous,count,next);b.append(controls);
    }
    const status={length:'已达到回复长度上限',cancelled:'已停止 · 保留部分回复',error:'回复中断 · 保留部分回复'}[m.finishReason];
    if(status){const tip=document.createElement('small');tip.textContent=status;b.append(tip);}
    {
      b.tabIndex=0;b.setAttribute('aria-haspopup','menu');
      b.oncontextmenu=e=>{e.preventDefault();const rect=b.getBoundingClientRect();openMessageMenu(b,isGroup(chat)?(m.characterId||groupReply.value||null):role?.id,m.content,e.clientX||rect.left+16,e.clientY||rect.top+16,label.textContent);};
      b.onkeydown=e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey){e.preventDefault();const rect=b.getBoundingClientRect();openMessageMenu(b,isGroup(chat)?(m.characterId||groupReply.value||null):role?.id,m.content,rect.left+16,rect.top+16,label.textContent);}};
    }
    $('#messages').append(row);
  }
  if(chat?.externalEntry)$('#subtitle').textContent+=' · '+chat.externalEntry.toUpperCase()+' 对话记录，点击新聊天可开始独立任务';
  const pending=isGroup(chat)?!!chat.pendingTurn:messages.at(-1)?.role==='user',available=isGroup(chat)?chat.participants.some(p=>roles.some(r=>r.id===p.characterId)):!!role;
  $('#send').disabled=running||!available||(!isGroup(chat)&&pending);$('#message').disabled=$('#send').disabled;$('#retry').hidden=!pending||!available||running;$('#retry').disabled=running;$('#retry').textContent=isGroup(chat)?'继续未完成回复':'重试';
  $('#stop').hidden=!running;$('#stop').disabled=!chat||!(chat.generating||liveText);
  $('#send').textContent=running?'回复中…':'发送 ↗';
  if(chat?.error)notice(chat.error);list.scrollTop=follow?list.scrollHeight:previousTop;updateLatestButton();if(!findBar.hidden)searchMessages();
}
function preview(field){const img=$(`#${field}Preview`);img.hidden=!draft[field];img.src=draft[field]||'';}
let memoryRecords=[],memoryRoleId=null,memoryEditing=null,memorySaving=false;
const retrievalLabel=document.createElement('label');retrievalLabel.className='autoMemoryToggle';const retrievalToggle=document.createElement('input');retrievalToggle.type='checkbox';retrievalLabel.append(retrievalToggle,document.createTextNode('按当前话题检索记忆'));$('#memoryInfo').after(retrievalLabel);
const retrievalHelp=document.createElement('p');retrievalHelp.className='muted';retrievalHelp.textContent='默认开启：按话题选择长期记忆，并从本角色的历史聊天向量索引中找原文和前后消息。聊天时自动扩展同义表达。关闭后仅按重要度选取长期记忆。';retrievalLabel.after(retrievalHelp);
const historySearchButton=document.createElement('button');historySearchButton.type='button';historySearchButton.textContent='检索历史记忆';retrievalHelp.after(historySearchButton);
const historyDialog=document.createElement('dialog');historyDialog.innerHTML='<form><div class="dialogHead"><h2>检索历史记忆</h2><button type="button" class="closeHistory">关闭</button></div><label>话题或关键词<input name="query" required maxlength="3000" placeholder="例如：以前讨论的旅行计划"></label><button type="submit">查找原文</button></form><p role="status"></p><div class="historyResults"></div>';document.body.append(historyDialog);let historyRoleId;
historyDialog.querySelector('.closeHistory').onclick=()=>historyDialog.close();
historySearchButton.onclick=()=>{historyRoleId=memoryRoleId;historyDialog.querySelector('.historyResults').replaceChildren();historyDialog.querySelector('[role=status]').textContent='按当前角色检索，显示聊天、时间和原文位置。';historyDialog.showModal();historyDialog.querySelector('input').focus();};
historyDialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const id=historyRoleId,status=historyDialog.querySelector('[role=status]'),list=historyDialog.querySelector('.historyResults');status.textContent='正在检索…';list.replaceChildren();try{const data=await api(`characters/${id}/memory-search?q=${encodeURIComponent(historyDialog.querySelector('input').value.trim())}`);if(id!==historyRoleId)return;status.textContent=`找到 ${data.results.length} 处相关原文 · 保存于 ${data.root}`;for(const hit of data.results)list.append(historyResult(hit,id,historyDialog));}catch(error){status.textContent=error.message;}};
function historyResult(hit,roleId,dialog){
  const box=document.createElement('article');box.className='memoryItem';const title=document.createElement('strong');title.textContent=`${hit.title} · ${hit.createdAt?new Date(hit.createdAt).toLocaleString('zh-CN'):'时间未知'}`;const text=document.createElement('p');text.textContent=hit.text;const file=document.createElement('small');file.className='muted';file.textContent=`原文：${hit.file} · ${hit.messageId||hit.recordId}`;box.append(title,text,file);
  if(hit.neighbors?.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='前后消息';details.append(summary);for(const m of hit.neighbors){const p=document.createElement('p');p.textContent=`${m.role==='user'?'用户':'AI'}：${m.content}`;details.append(p);}box.append(details);}
  if(hit.chatId&&!hit.legacyArchive){const open=document.createElement('button');open.type='button';open.textContent='打开来源消息';open.onclick=async()=>{try{if(sending)return;const data=await api(`chats/${hit.chatId}`);if(!belongsTo(data,roleId))throw Error('来源角色已变化');chat=data;selected=roleId;dialog.close();$('#memoryDialog').close();render();const target=[...$('#messages').querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===hit.messageId);if(target){target.classList.add('searchCurrent');target.scrollIntoView({block:'center'});}}catch(error){notice(error.message);}};box.append(open);}
  return box;
}
retrievalToggle.onchange=async()=>{const id=memoryRoleId,enabled=retrievalToggle.checked;retrievalToggle.disabled=true;try{const data=await api(`characters/${id}/memories/retrieval`,'PUT',{enabled});if(memoryRoleId===id)memoryData(data);}catch(error){retrievalToggle.checked=!enabled;$('#memoryStatus').textContent=error.message;}finally{retrievalToggle.disabled=false;}};
const reviewMemoryButton=document.createElement('button');reviewMemoryButton.type='button';reviewMemoryButton.textContent='记忆质量检查';$('#addMemory').after(reviewMemoryButton);
const reviewDialog=document.createElement('dialog');reviewDialog.id='memoryReviewDialog';reviewDialog.innerHTML='<div class="dialogHead"><h2>检查相似记忆</h2><button type="button">关闭</button></div><p>根据文字相似度找出候选，不代表事实相同或必然冲突。请核对人物、时间和否定词。不会自动修改记忆。</p><p class="reviewStatus" role="status"></p><div class="reviewPairs"></div>';
document.body.append(reviewDialog);reviewDialog.querySelector('button').onclick=()=>{if(!memorySaving)reviewDialog.close();};reviewDialog.addEventListener('cancel',e=>{if(memorySaving)e.preventDefault();});
reviewDialog.querySelector('h2').textContent='记忆质量检查';reviewDialog.querySelector('p').textContent='本地规则检查重复、相似及疑似矛盾（否定词、数字差异），不代表完整的语义判断。候选不会自动改写；不同人物或不同时间的事实可以同时成立。';
const sourceDialog=document.createElement('dialog');sourceDialog.id='memorySources';sourceDialog.innerHTML='<div class="dialogHead"><h2>记忆来源</h2><button type="button">关闭</button></div><p class="muted">显示来源消息的当前版本（不保证与最初提取时完全一致）；合并记忆会追溯原记录。旧版、手机导入或手工新增的记忆可能没有本机聊天来源。</p><div class="sourceRows"></div><p role="status"></p>';document.body.append(sourceDialog);sourceDialog.querySelector('button').onclick=()=>sourceDialog.close();
function sourceButton(record,roleId){
  const button=document.createElement('button');button.type='button';button.textContent='查看来源';
  button.onclick=async()=>{const rows=sourceDialog.querySelector('.sourceRows'),status=sourceDialog.querySelector('[role=status]');rows.replaceChildren();status.textContent='正在查找来源…';sourceDialog.showModal();
    try{const data=await api(`characters/${roleId}/memories/${record.id}/sources`);status.textContent=data.sources.length?(data.truncated?'来源较多，本次仅显示前 20 条。':''):'这条记忆没有可追溯的本机聊天来源。';
      for(const source of data.sources){const box=document.createElement('article');box.className='memoryItem';const title=document.createElement('p');title.textContent=source.unavailable?'来源聊天或消息已不存在':`${source.title}${source.inTrash?' · 在聊天回收站中':''}`;box.append(title);
        if(!source.unavailable){const text=document.createElement('p');text.textContent=source.content.slice(0,6000)+(source.content.length>6000?'\n（仅预览前 6000 字）':'');box.append(text);
          const open=document.createElement('button');open.type='button';open.textContent=source.inTrash?'请先恢复来源聊天':'打开来源消息';open.disabled=source.inTrash||sending;
          open.onclick=async()=>{try{if(sending)return;const data=await api(`chats/${source.chatId}`);if(!belongsTo(data,roleId))throw Error('来源角色不匹配');chat=data;selected=data.characterId;sourceDialog.close();reviewDialog.close();$('#memoryDialog').close();notice();render();const target=[...$('#messages').querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===source.messageId);if(target){target.classList.add('searchCurrent');target.scrollIntoView({block:'center'});}}catch(error){status.textContent=error.message;}};box.append(open);
        }rows.append(box);
      }
    }catch(error){status.textContent=error.message;}
  };return button;
}
let reviewRoleId=null;
async function loadMemoryReview(){
  const status=reviewDialog.querySelector('.reviewStatus'),list=reviewDialog.querySelector('.reviewPairs');list.replaceChildren();status.textContent='正在检查…';
  const data=await api(`characters/${reviewRoleId}/memories/review`);
  status.textContent=`检查 ${data.scanned} / ${data.total} 条，找到 ${data.totalPairs} 组候选（最多显示 50 组）。`+(data.total>500?'本次仅检查最后 500 条记忆。':'');
  for(const pair of data.pairs){
    const box=document.createElement('article');box.className='memoryItem';
    const heading=document.createElement('strong');heading.textContent=pair.kind==='conflict'?`疑似矛盾：${pair.reason}`:pair.exact?'重复候选：文字基本相同':'相似候选：请核对是否重复';box.append(heading);
    for(const r of [pair.left,pair.right]){const p=document.createElement('p');p.textContent=r.text;const info=document.createElement('small');info.className='muted';info.textContent=`来源：${({automatic:'自动记忆',local:'本地新增',backup:'备份恢复',phone:'手机导入'})[r.source]||r.source||'手机导入'} · 有效期：${r.validUntil?new Date(r.validUntil).toLocaleString('zh-CN'):'未设置'}`;box.append(p,info,sourceButton(r,reviewRoleId));}
    const label=document.createElement('label');label.textContent='合并后的记忆（请确认准确性）';const input=document.createElement('textarea');input.rows=4;input.maxLength=100000;input.value=pair.exact?pair.left.text:pair.left.text+'\n'+pair.right.text;label.append(input);
    let keepId;
    if(pair.kind==='conflict'){input.value='';input.placeholder='先核对来源，再选择采用哪一条，或填写准确的新内容。';}
    input.oninput=()=>{keepId=undefined;};
    const choices=document.createElement('div');choices.className='actions';
    for(const [r,name] of [[pair.left,'采用第一条'],[pair.right,'采用第二条']]){const choose=document.createElement('button');choose.type='button';choose.textContent=name;choose.onclick=()=>{input.value=r.text;keepId=r.id;input.focus();};choices.append(choose);}
    const tip=document.createElement('p');tip.className='muted';tip.textContent='确认后用一条新记忆替代这两条，原文保留在本地删除记录中；有效期沿用两条中较早的到期时间。不同时间的事实可保持分开。';
    tip.textContent='确认后用编辑框中的一条记忆替代两条原记忆，原文保留为删除记录并可追溯来源。采用某一条时沿用其有效期；自行整理时沿用较早的到期时间。无需修改时直接关闭。';
    const button=document.createElement('button');button.type='button';button.textContent=pair.kind==='conflict'?'确认处理这组矛盾':'确认合并这两条';
    button.onclick=async()=>{if(memorySaving)return;if(!input.value.trim()){status.textContent='请先选择采用哪条记忆，或填写整理后的内容。';return;}memorySaving=true;button.disabled=true;try{const data=await api(`characters/${reviewRoleId}/memories/merge`,'POST',{records:[pair.left,pair.right].map(r=>({id:r.id,revision:r.revision||0})),text:input.value,keepId});if(memoryRoleId===reviewRoleId)memoryData(data);await loadMemoryReview();}catch(e){status.textContent=e.message;}finally{memorySaving=false;button.disabled=false;}};
    box.append(choices,label,tip,button);list.append(box);
  }
}
reviewMemoryButton.onclick=async()=>{reviewRoleId=memoryRoleId;reviewDialog.showModal();try{await loadMemoryReview();}catch(e){reviewDialog.querySelector('.reviewStatus').textContent=e.message;}};
function memoryData(data){$('#memoryTitle').textContent=(roles.find(r=>r.id===memoryRoleId)?.name||'当前角色')+' · 记忆管理';retrievalToggle.checked=data.retrievalEnabled!==false;memoryRecords=data.records;$('#memoryInfo').textContent=`共 ${memoryRecords.length} 条记忆`+(data.sourceRoleName?` · 导入来源：${data.sourceRoleName} · 备份时间：${data.exportedAt?new Date(data.exportedAt).toLocaleString('zh-CN'):'未知'}`:' · 本地保存');showMemories();if(data.automatic)showAutomaticMemory(data.automatic);}
function showAutomaticMemory(state){
  $('#automaticMemory').checked=state.enabled;
  $('#automaticMemoryStatus').textContent=!state.enabled?'已关闭，不再自动保存新记忆。':state.status==='running'?'正在后台判断本轮是否有值得记住的信息…':state.status==='error'?state.error:state.status==='done'?`最近一次整理：新增 ${state.added} 条记忆。每轮额外调用一次 DeepSeek。`:'已开启：回复完成后自动整理，每轮额外调用一次 DeepSeek。';
}
$('#automaticMemory').onchange=async e=>{
  const id=memoryRoleId,enabled=e.target.checked;e.target.disabled=true;
  try{const data=await api(`characters/${id}/memories/automatic`,'PUT',{enabled});if(memoryRoleId===id)memoryData(data);}
  catch(error){e.target.checked=!enabled;$('#automaticMemoryStatus').textContent=error.message;}
  finally{e.target.disabled=false;}
};
let memoryPolling=false;
setInterval(async()=>{
  if(memoryPolling||!$('#memoryDialog').open||$('#memoryEditor').open||$('#memoryImportDialog').open||reviewDialog.open||memorySaving||$('#automaticMemory').disabled)return;
  memoryPolling=true;const id=memoryRoleId;
  try{const data=await api(`characters/${id}/memories`);if(memoryRoleId===id&&$('#memoryDialog').open){const scroll=$('#memoryList').scrollTop;memoryData(data);$('#memoryList').scrollTop=scroll;}}
  catch{}finally{memoryPolling=false;}
},2500);
let memorySourceRef=null;
function editMemory(record=null,messageText=null,source=null){
  memorySourceRef=source;
  memoryEditing=record;$('#memoryText').value=record?.text??messageText??'';
  $('#memoryEditTitle').textContent=record?'编辑记忆':messageText!==null?'将消息存为记忆':'新增记忆';
  $('#memoryEditContext').textContent=`保存到：${roles.find(r=>r.id===memoryRoleId)?.name||'当前角色'}`+(messageText!==null?'。请将内容整理成明确的事实，写清“用户”或角色名字，再点击保存。':'');
  $('#memoryEditError').textContent='';$('#memoryEditor').showModal();$('#memoryText').focus();
}
function showMemories(){
  const query=$('#memorySearch').value.trim().toLowerCase(),rows=memoryRecords.filter(r=>r.text.toLowerCase().includes(query));
  $('#memoryList').replaceChildren(...rows.map(r=>{
    const box=document.createElement('article');box.className='memoryItem';const p=document.createElement('p');p.textContent=r.text;
    const meta=document.createElement('small');meta.className='muted';meta.textContent=(r.source==='local'?'本地新增':r.source==='automatic'?'自动记忆':r.source==='backup'?'备份恢复':'手机导入')+(r.locallyEdited&&r.source!=='local'?' · 已本地修改':'');
    const actions=document.createElement('div');actions.className='actions';
    const edit=document.createElement('button');edit.textContent='编辑';edit.onclick=()=>editMemory(r);
    const del=document.createElement('button');del.textContent='删除';del.className='danger';del.onclick=async()=>{
      if(memorySaving||!confirm('删除这条记忆？删除后不再用于后续回复。'))return;
      memorySaving=true;del.disabled=true;$('#memoryStatus').textContent='';
      try{memoryData(await api(`characters/${memoryRoleId}/memories/${r.id}`,'DELETE',{revision:r.revision||0}));$('#memoryStatus').textContent='记忆已删除';}
      catch(e){$('#memoryStatus').textContent=e.message;}finally{memorySaving=false;del.disabled=false;}
    };
    actions.append(edit,del,sourceButton(r,memoryRoleId));box.append(p,meta,actions);return box;
  }));
  if(!rows.length){const p=document.createElement('p');p.textContent=query?'没有匹配的记忆':'还没有记忆，点击“新增记忆”开始。';$('#memoryList').append(p);}
}
$('#addMemory').onclick=()=>editMemory();
let memoryBackup=null,memoryImportTarget=null,memoryImportBusy=false,memoryPreviewVersion=0;
$('#importMemory').onclick=()=>{
  memoryImportTarget=memoryRoleId;memoryBackup=null;++memoryPreviewVersion;
  $('#memoryImportForm').reset();$('#memoryImportPreview').textContent='';$('#memoryImportError').textContent='';$('#restoreMemory').disabled=true;
  $('#memoryImportTarget').textContent=`恢复到：${roles.find(r=>r.id===memoryImportTarget)?.name||'当前角色'}`;
  $('#memoryImportDialog').showModal();
};
$('#memoryBackupFile').onchange=async e=>{
  const version=++memoryPreviewVersion,file=e.target.files[0];memoryBackup=null;$('#restoreMemory').disabled=true;$('#memoryImportError').textContent='';$('#memoryImportPreview').textContent='';
  try{
    if(!file)return;if(file.size>6000000)throw new Error('记忆备份不能超过 6 MB');
    let backup;try{backup=JSON.parse((await file.text()).replace(/^\uFEFF/,''));}catch{throw new Error('文件不是有效的 JSON 备份');}
    const preview=await api(`characters/${memoryImportTarget}/memories/import`,'POST',{backup,preview:true});
    if(version!==memoryPreviewVersion)return;
    memoryBackup=backup;$('#memoryImportPreview').textContent=`来源角色：${preview.sourceName}\n共 ${preview.total} 条 · 将新增 ${preview.added} 条 · 跳过 ${preview.skipped} 条重复或已删除记忆\n`+(preview.samples.length?'新增内容预览：\n'+preview.samples.join('\n\n'):'没有需要新增的记忆。');
    $('#restoreMemory').disabled=preview.added===0;
  }catch(error){if(version===memoryPreviewVersion)$('#memoryImportError').textContent=error.message;}
};
$('#memoryImportForm').onsubmit=async e=>{
  e.preventDefault();if(!memoryBackup||memoryImportBusy)return;
  memoryImportBusy=true;$('#restoreMemory').disabled=true;$('#memoryBackupFile').disabled=true;
  try{
    const result=await api(`characters/${memoryImportTarget}/memories/import`,'POST',{backup:memoryBackup,preview:false});
    if(memoryRoleId===memoryImportTarget){$('#memorySearch').value='';memoryData(result.memory);$('#memoryStatus').textContent=`恢复完成：新增 ${result.summary.added} 条，跳过 ${result.summary.skipped} 条。`;}
    $('#memoryImportDialog').close();
  }catch(error){$('#memoryImportError').textContent=error.message;}
  finally{memoryImportBusy=false;$('#restoreMemory').disabled=false;$('#memoryBackupFile').disabled=false;}
};
$('#memoryImportDialog').addEventListener('cancel',e=>{if(memoryImportBusy)e.preventDefault();});
$('#memoryImportDialog').addEventListener('close',()=>{++memoryPreviewVersion;});
async function downloadMemory(format){
  const id=memoryRoleId;$('#memoryStatus').textContent='正在准备记忆备份…';
  $('#exportMemoryJson').disabled=true;$('#exportMemoryTxt').disabled=true;
  try{
    const response=await fetch(`/api/characters/${id}/memories/export?format=${format}`);
    if(!response.ok)throw new Error((await response.json()).error);
    const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`muse-memory-${id}.${format}`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('#memoryStatus').textContent='已发起下载，请查看浏览器下载列表';
  }catch(error){$('#memoryStatus').textContent=error.message;}
  finally{$('#exportMemoryJson').disabled=false;$('#exportMemoryTxt').disabled=false;}
}
$('#exportMemoryJson').onclick=()=>downloadMemory('json');
$('#exportMemoryTxt').onclick=()=>downloadMemory('txt');
$('#memoryForm').onsubmit=async e=>{
  e.preventDefault();if(memorySaving)return;memorySaving=true;e.submitter.disabled=true;
  try{const path=`characters/${memoryRoleId}/memories`+(memoryEditing?`/${memoryEditing.id}`:'');memoryData(await api(path,memoryEditing?'PUT':'POST',{text:$('#memoryText').value,revision:memoryEditing?.revision||0,...(!memoryEditing?memorySourceRef:{})}));$('#memoryEditor').close();$('#memoryStatus').textContent='记忆已保存，将用于后续回复';if(!$('#memoryDialog').open)notice('已存入当前角色的记忆库，将用于后续回复');}
  catch(error){$('#memoryEditError').textContent=error.message;}
  finally{memorySaving=false;e.submitter.disabled=false;}
};
$('#memorySearch').oninput=showMemories;
$('#memoryDialog').addEventListener('click',e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();});
$('#memories').onclick=guarded(async()=>{const roleId=selected,data=await api(`characters/${roleId}/memories`);memoryRoleId=roleId;$('#memorySearch').value='';$('#memoryStatus').textContent='';memoryData(data);$('#memoryDialog').showModal();});
const roleQQBinding=installQQRoleBinding({api,form:$('#roleForm'),editor:$('#editor'),getRoles:()=>roles});
function openEditor(role=null){editing=role?.id||null;draft={avatar:role?.avatar||'',background:role?.background||''};$('#roleForm').reset();for(const [k,v]of Object.entries(role||{})){const input=$('#roleForm').elements.namedItem(k);if(input)input.value=v;}for(const k of ['avatar','background'])preview(k);$('#editorTitle').textContent=editing?'编辑角色':imported?'导入角色预览':'创建角色';$('#formError').textContent='';$('#editor').showModal();roleQQBinding.load(editing);}
$('#create').onclick=()=>{imported=null;$('#importNotice').textContent='';openEditor();};
$('#edit').onclick=()=>{imported=null;$('#importNotice').textContent='';openEditor(roles.find(r=>r.id===selected));};
$('#roleForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const data={...Object.fromEntries(new FormData(e.target)),...draft};if(imported)data.importCard=imported;const saved=await api(editing?`characters/${editing}`:'characters',editing?'PUT':'POST',data);selected=saved.id;if(!editing)chat=null;$('#editor').close();await refresh();notice('角色已保存');}catch(e){$('#formError').textContent=e.message;}finally{button.disabled=false;}};
for(const field of ['avatar','background']){
  $(`#${field}File`).onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>2000000||!['image/png','image/jpeg','image/webp'].includes(f.type))throw new Error('请选择 2 MB 以内的 PNG / JPEG / WebP');draft[field]=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(f);});preview(field);}catch(e){$('#formError').textContent=e.message;}};
  $(`#clear${field[0].toUpperCase()+field.slice(1)}`).onclick=()=>{draft[field]='';$(`#${field}File`).value='';preview(field);};
}
$('#import').onclick=()=>$('#importDialog').showModal();
$('#chooseCard').onclick=()=>$('#cardFile').click();
async function loadCard(file){
  $('#import').disabled=true;
  $('#chooseCard').disabled=true;$('#dropzone').textContent='正在读取角色卡…';$('#importError').textContent='';
  try{
    if(!file)return;
    if(/\.(muse-assistant|zip)$/i.test(file.name)){
      if(file.size>20000000)throw new Error('手机角色包不能超过 20 MB');
      const response=await fetch('/api/import/muse',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      const parsed=await response.json();if(!response.ok)throw new Error(parsed.error);
      if(parsed.avatarData){const [prefix,base64]=parsed.avatarData.split(',');const blob=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:prefix.slice(5,-7)});parsed.character.avatar=await pngAvatar(blob);}
      imported={...parsed.character,avatar:'',background:''};
      $('#importDialog').close();openEditor({...parsed.character,id:undefined});
      $('#importNotice').textContent=['手机角色包已读取，点击保存即可加入角色库。',...parsed.warnings].join(' ');
      return;
    }
    if(file.size>7000000)throw new Error('JSON／PNG 角色卡不能超过 7 MB');
    let card,avatar='',warnings=[];
    if(file.name.toLowerCase().endsWith('.png')){
      const png=parsePngCard(await file.arrayBuffer());card=png.card;warnings=png.warnings;
      avatar=await pngAvatar(file);
    }else if(file.name.toLowerCase().endsWith('.json')){
      try{card=JSON.parse((await file.text()).replace(/^\uFEFF/,''));}catch{throw new Error('JSON 格式无效，请检查角色卡文件');}
    }else throw new Error('请选择手机导出的 .muse-assistant、ZIP、JSON 或 PNG 文件');
    const parsed=await api('import','POST',card);imported=card;
    $('#importDialog').close();
    openEditor({...parsed.character,...(avatar?{avatar}:{}),id:undefined});
    $('#importNotice').textContent=['检查内容后保存为新角色。',...(avatar?['PNG 图片已作为头像，可替换或清除。']:[]),...warnings,...parsed.warnings].join(' ');
  }catch(e){$('#importError').textContent=e.message;}
  finally{$('#cardFile').value='';$('#import').disabled=false;$('#chooseCard').disabled=false;$('#dropzone').textContent='把手机导出的角色卡拖到这里';}
}
$('#cardFile').onchange=e=>loadCard(e.target.files[0]);
$('#dropzone').ondragover=e=>{e.preventDefault();};
$('#dropzone').ondrop=e=>{e.preventDefault();if($('#chooseCard').disabled)return;if(e.dataTransfer.files.length!==1){$('#importError').textContent='请每次放入一个角色卡文件';return;}loadCard(e.dataTransfer.files[0]);};
$('#deleteRole').textContent='移入角色回收站';
$('#deleteRole').onclick=guarded(async()=>{if(!confirm('将该角色移入回收站？聊天和记忆保留，恢复角色后可继续聊天。'))return;const role=roles.find(r=>r.id===selected);if(!role)return;await api(`characters/${selected}`,'DELETE',{updatedAt:role.updatedAt});saveDraft();await refresh();notice('角色已移入回收站，聊天和记忆已保留，可在设置中恢复');});
const chooseRoleSearch=document.createElement('input');chooseRoleSearch.type='search';chooseRoleSearch.placeholder='搜索角色名称';chooseRoleSearch.setAttribute('aria-label','搜索新对话角色');$('#chooseChatRoles').before(chooseRoleSearch);
let choosingRole=false;
function renderChooseRoles(){
  const visible=matchingRoles(chooseRoleSearch.value);
  $('#chooseChatRoles').replaceChildren(...visible.map(role=>{
    const button=item(role.name,false,async()=>{
      if(choosingRole)return;choosingRole=true;chooseRoleSearch.disabled=true;
      const buttons=[...$('#chooseChatRoles').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
      try{const created=await api('chats','POST',{characterId:role.id});selected=role.id;chat=created;$('#chooseChatDialog').close();notice();await refresh();}
      catch(error){$('#chooseChatError').textContent=error.message;}finally{choosingRole=false;chooseRoleSearch.disabled=false;buttons.forEach(b=>b.disabled=false);}
    },role);return button;
  }));
  $('#chooseChatError').textContent=!roles.length?'还没有角色，请先在左侧创建角色或导入角色卡。':!visible.length?'没有匹配的角色，请修改或清空搜索。':'';
}
chooseRoleSearch.oninput=()=>{if(!choosingRole)renderChooseRoles();};
$('#newChat').onclick=guarded(async()=>{
  if(chatListKind==='group'){groupButton.click();return;}
  if(choosingRole)return;
  roles=await api('characters');chooseRoleSearch.value='';renderChooseRoles();
  $('#chooseChatDialog').showModal();chooseRoleSearch.focus();
});
$('#deleteChat').textContent='移入回收站';
$('#deleteChat').onclick=guarded(async()=>{if(!confirm('将此聊天移入回收站？之后可在设置中恢复。'))return;await api(`chats/${chat.id}`,'DELETE',{updatedAt:chat.updatedAt});saveDraft();writeLocal(lastContextKey,null);chat=null;await refresh();notice('聊天已移入回收站，可在设置中恢复');});
$('#renameChat').onclick=()=>{$('#chatName').value=chat.title;$('#renameError').textContent='';$('#renameDialog').showModal();};
$('#renameForm').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{chat=await api(`chats/${chat.id}`,'PUT',{title:$('#chatName').value,updatedAt:chat.updatedAt});$('#renameDialog').close();await refresh();notice('聊天已重命名');}catch(error){$('#renameError').textContent=error.message;}finally{e.submitter.disabled=false;}};
async function downloadChat(format){
  const id=chat.id,response=await fetch(`/api/chats/${id}/export?format=${format}`);if(!response.ok)throw new Error((await response.json()).error);
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`muse-chat-${id}.${format}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);notice('已发起下载，请查看浏览器下载列表');
}
$('#exportJson').onclick=guarded(()=>downloadChat('json'));$('#exportMd').onclick=guarded(()=>downloadChat('md'));
async function send(retry=false,regenerate=null){
  if(sending||chat?.generating)return;
  if(chat?.externalEntry){notice('请在 '+chat.externalEntry.toUpperCase()+' 继续此聊天，或点击“新聊天”与同一角色开始独立任务。');return;}
  const content=$('#message').value;if(!retry&&!regenerate&&!content.trim())return;
  sending=true;liveText=null;notice('正在等待 DeepSeek 回复…');render();
  let finished=false;
  try{
    if(!chat){
      chat=await api('chats','POST',{characterId:selected});
      const value=$('#message').value;discardCurrentDraft();syncDraft();$('#message').value=value;saveDraft();
    }
    const response=await fetch(`/api/chats/${chat.id}/messages`,{method:'POST',headers:{...entryHeader,'Content-Type':'application/json'},body:JSON.stringify({stream:true,...(isGroup(chat)&&groupReply.value?{replyCharacterId:groupReply.value}:{}),...(regenerate?{regenerate:true,messageId:regenerate.messageId,updatedAt:regenerate.updatedAt}:retry?{retry:true}:{content})})});
    if(!response.ok)throw new Error((await response.json()).error);
    const reader=response.body.getReader(), decoder=new TextDecoder();let buffer='';
    try { while(true){
      const {value,done}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true});let end;
      while((end=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
        const event=JSON.parse(line);
        if(event.type==='start'){
          chat={...event.chat,generating:true,task:event.task};if(!retry&&!regenerate){$('#message').value='';saveDraft();}render();
          if(!isGroup(chat)){const {row,bubble}=messageShell({role:'assistant',createdAt:Date.now()},roles.find(r=>r.id===chat.characterId),true);
          liveText=document.createElement('span');bubble.append(liveText);$('#messages').append(row);}
          notice('正在等待回复，可随时停止生成…');updateLatestButton();
        }else if(event.type==='speaker'){
          const {row,bubble}=messageShell({role:'assistant',characterId:event.characterId,characterName:event.characterName,createdAt:Date.now()},null,true);liveText=document.createElement('span');bubble.append(liveText);$('#messages').append(row);notice(event.characterName+' 正在回复…');
        }else if(event.type==='reply'){
          chat={...event.chat,generating:true,task:chat?.task};liveText=null;render();
        }else if(event.type==='tool'){
          notice(`DSH 工具 ${event.tool}：${event.status==='running'?'执行中，需要审批时请到 DSH 确认':event.status==='completed'?'已返回结果':'结果未知，请核对'}`);
        }else if(event.type==='delta'){
          const list=$('#messages'),follow=list.scrollHeight-list.scrollTop-list.clientHeight<100;
          liveText?.append(document.createTextNode(event.content));notice('正在生成…');if(follow)list.scrollTop=list.scrollHeight;updateLatestButton();
        }else if(event.type==='done'||event.type==='error'){
          chat=event.chat;finished=true;notice(event.error||'');
        }
      }
    }} finally {reader.releaseLock();}
    if(!finished)throw new Error('连接已断开，正在恢复已保存的聊天。');
  }catch(e){notice(e.message);if(chat)chat=await api(`chats/${chat.id}`);}
  finally{sending=false;liveText=null;await refresh();}
}
$('#stop').onclick=guarded(async()=>{if(!chat)return;$('#stop').disabled=true;notice('正在停止生成…');try{await api(`chats/${chat.id}/stop`,'POST',{taskId:chat.task?.id});}catch(e){$('#stop').disabled=false;throw e;}});
// A refreshed tab can still stop a request started before the refresh.
setInterval(()=>{if(chat?.generating&&!sending)guarded(async()=>{chat=await api(`chats/${chat.id}`);render();})();},1500);
$('#composer').onsubmit=guarded(async e=>{e.preventDefault();await send();});$('#retry').onclick=guarded(()=>send(true));
const sendModeKey='muse:send-mode:v1';
const composerOptions=document.createElement('div');composerOptions.className='composerOptions';
const sendModeLabel=document.createElement('label');sendModeLabel.textContent='发送方式';
const sendMode=document.createElement('select');sendMode.setAttribute('aria-label','发送快捷键');
for(const [value,label] of [['enter','Enter 发送'],['ctrl-enter','Ctrl+Enter 发送']]){const option=document.createElement('option');option.value=value;option.textContent=label;sendMode.append(option);}
sendMode.value=readLocal(sendModeKey)==='ctrl-enter'?'ctrl-enter':'enter';
const sendHint=document.createElement('span');sendHint.id='sendHint';$('#message').setAttribute('aria-describedby','sendHint');
function updateSendHint(){sendHint.textContent=sendMode.value==='ctrl-enter'?'Enter 换行 · Ctrl+Enter 发送（Mac：⌘+Enter）':'Enter 发送 · Shift+Enter 换行';}
sendMode.onchange=()=>{updateSendHint();try{localStorage.setItem(sendModeKey,sendMode.value);}catch{notice('发送方式已切换，但浏览器无法保存此设置。');}};
sendModeLabel.append(sendMode);composerOptions.append(sendHint);$('#composer').after(composerOptions);updateSendHint();
const generalSettingsButton=document.createElement('button');generalSettingsButton.type='button';generalSettingsButton.className='settings';generalSettingsButton.textContent='⚙ 设置';$('#settings').before(generalSettingsButton);
const generalSettings=document.createElement('dialog');generalSettings.id='generalSettings';generalSettings.setAttribute('aria-labelledby','generalSettingsTitle');
generalSettings.innerHTML='<div class="dialogHead"><h2 id="generalSettingsTitle">设置</h2><button type="button" class="closeSettings">关闭</button></div><section class="settingsSection"><h3>聊天</h3><div class="sendPreference"></div><p class="muted">默认 Enter 发送，Shift+Enter 换行。修改后自动保存在当前浏览器。</p></section><section class="settingsSection"><h3>模型连接</h3><div class="modelSettings"></div></section><section class="settingsSection"><h3>数据与备份</h3><div class="backupSettings"></div><p class="muted">完整备份包含角色、聊天和记忆；聊天备份用于单独恢复一段聊天。</p></section>';
document.body.append(generalSettings);
installDshSettings({api,settings:generalSettings,getRoles:()=>roles,getChat:()=>chat});
installLanSyncSettings({api,settings:generalSettings});
installQQSettings({api,settings:generalSettings});
const appearance=document.createElement('section');appearance.className='settingsSection';
const appearanceTitle=document.createElement('h3');appearanceTitle.textContent='外观';
const themeLabel=document.createElement('label');themeLabel.textContent='主题 ';
const themeSelect=document.createElement('select');themeSelect.setAttribute('aria-label','外观主题');
for(const [value,label] of [['light','浅色'],['dark','深色'],['system','跟随系统']]){const option=document.createElement('option');option.value=value;option.textContent=label;themeSelect.append(option);}
themeSelect.value=themeMode;themeSelect.onchange=()=>{themeMode=themeSelect.value;applyTheme();try{localStorage.setItem(themeKey,themeMode);}catch{notice('外观已切换，但浏览器无法保存此设置。');}};
const themeHelp=document.createElement('p');themeHelp.className='muted';themeHelp.textContent='立即生效并自动保存；跟随系统会随系统外观自动切换。';
themeLabel.append(themeSelect);appearance.append(appearanceTitle,themeLabel,themeHelp);generalSettings.querySelector('.dialogHead').after(appearance);
generalSettings.querySelector('.sendPreference').append(sendModeLabel);
const chatFontKey='muse:chat-font:v1',chatFontSizes={standard:14,large:16,largest:18};
const chatFontLabel=document.createElement('label');chatFontLabel.textContent='聊天字号';
const chatFont=document.createElement('select');chatFont.setAttribute('aria-label','聊天字号');
for(const [value,label] of [['standard','标准 · 14 px'],['large','较大 · 16 px'],['largest','大号 · 18 px']]){const option=document.createElement('option');option.value=value;option.textContent=label;chatFont.append(option);}
const savedChatFont=readLocal(chatFontKey);chatFont.value=Object.hasOwn(chatFontSizes,savedChatFont)?savedChatFont:'standard';
const chatFontPreview=document.createElement('p');chatFontPreview.className='chatFontPreview';chatFontPreview.textContent='预览：今天想聊些什么？每一段故事，都值得慢慢阅读。';
function applyChatFont(){document.documentElement.style.setProperty('--chat-font-size',`${chatFontSizes[chatFont.value]}px`);resizeComposer();}
chatFont.onchange=()=>{applyChatFont();try{localStorage.setItem(chatFontKey,chatFont.value);}catch{notice('聊天字号已调整，但浏览器无法保存此设置。');}};
chatFontLabel.append(chatFont);generalSettings.querySelector('.sendPreference').append(chatFontLabel,chatFontPreview);applyChatFont();
generalSettings.querySelector('.modelSettings').append($('#settings'),$('#keyStatus'));
generalSettings.querySelector('.backupSettings').append(backupButton,$('#importChat'));
const trashButton=document.createElement('button');trashButton.type='button';trashButton.textContent='聊天回收站';generalSettings.querySelector('.backupSettings').append(trashButton);
const roleTrashButton=document.createElement('button');roleTrashButton.type='button';roleTrashButton.textContent='角色回收站';generalSettings.querySelector('.backupSettings').append(roleTrashButton);
const trashDialog=document.createElement('dialog');trashDialog.id='trashDialog';trashDialog.setAttribute('aria-labelledby','trashTitle');trashDialog.innerHTML='<div class="dialogHead"><h2 id="trashTitle">聊天回收站</h2><button type="button" class="trashClose">关闭</button></div><p class="muted">移入回收站的聊天不会自动清理。恢复后保留消息、分支和置顶／归档状态；彻底删除无法撤销，已有导出备份仍会保留。</p><div class="trashList"></div><p role="status"></p>';document.body.append(trashDialog);
let trashBusy=false,trashKind='chats';
trashDialog.querySelector('.trashClose').onclick=()=>{if(!trashBusy)trashDialog.close();};trashDialog.addEventListener('cancel',e=>{if(trashBusy)e.preventDefault();});
async function loadTrash(){
  const isRole=trashKind==='characters',rows=(await api(`${trashKind}?trash=1`)).sort((a,b)=>b.deletedAt-a.deletedAt),list=trashDialog.querySelector('.trashList');list.replaceChildren();
  if(!rows.length){const empty=document.createElement('p');empty.textContent='回收站为空';list.append(empty);}
  for(const row of rows){
    const box=document.createElement('div');box.className='memoryItem';const title=document.createElement('p');title.textContent=isRole?row.name:row.title;
    const detail=document.createElement('p');detail.className='muted';detail.textContent=`${row.characterName} · ${row.messageCount} 条 · 删除于 ${new Date(row.deletedAt).toLocaleString('zh-CN')}`+(row.archived?' · 已归档':'')+(roles.some(r=>r.id===row.characterId)?'':' · 角色已删除，恢复后只读');
    if(isRole)detail.textContent=`删除于 ${new Date(row.deletedAt).toLocaleString('zh-CN')} · 恢复后沿用原角色和记忆`;
    const actions=document.createElement('div');actions.className='actions';
    for(const [action,label] of [['restore',isRole?'恢复角色':'恢复聊天'],['purge','彻底删除']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;if(action==='purge')button.className='danger';
      button.onclick=async()=>{
        if(trashBusy)return;if(action==='purge'&&!confirm(`彻底删除“${isRole?row.name:row.title}”？${isRole?'角色设定和角色记忆库将一并删除；历史聊天及其中的记忆快照保留。':''}此操作无法撤销。`))return;
        trashBusy=true;trashDialog.querySelectorAll('button').forEach(b=>b.disabled=true);const status=trashDialog.querySelector('[role=status]');status.textContent='正在处理…';
        try{await api(`${trashKind}/${row.id}/${action}`,action==='restore'?'POST':'DELETE',{updatedAt:row.updatedAt});if(action==='purge')writeLocal(draftPrefix+`${isRole?'role':'chat'}:${row.id}`,null);await refresh();await loadTrash();status.textContent=action==='restore'?(isRole?'角色已恢复，原聊天可继续使用。':row.archived?'已恢复，可在已归档列表中查看。':'已恢复到聊天列表。'):'已彻底删除。';}
        catch(error){status.textContent=error.message;}
        finally{trashBusy=false;trashDialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
      };actions.append(button);
    }
    box.append(title,detail,actions);list.append(box);
  }
}
async function openTrash(kind){trashKind=kind;const isRole=kind==='characters';$('#trashTitle').textContent=isRole?'角色回收站':'聊天回收站';trashDialog.querySelector('p.muted').textContent=isRole?'恢复角色会保留原身份、设定、图片、置顶状态和记忆关联，原聊天可继续使用。彻底删除会删除角色和角色记忆库；历史聊天、聊天中的记忆快照及已有备份仍保留。':'移入回收站的聊天不会自动清理。恢复后保留消息、分支和置顶／归档状态；彻底删除无法撤销，已有导出备份仍会保留。';trashDialog.querySelector('[role=status]').textContent='正在加载…';trashDialog.querySelector('.trashList').replaceChildren();trashDialog.showModal();try{await loadTrash();trashDialog.querySelector('[role=status]').textContent='';}catch(error){trashDialog.querySelector('[role=status]').textContent=error.message;}}
trashButton.onclick=()=>openTrash('chats');roleTrashButton.onclick=()=>openTrash('characters');
generalSettingsButton.onclick=()=>generalSettings.showModal();
generalSettings.querySelector('.closeSettings').onclick=()=>generalSettings.close();
$('#message').onkeydown=e=>{
  if(e.key!=='Enter'||e.isComposing||e.keyCode===229||e.shiftKey||e.altKey)return;
  const submit=sendMode.value==='ctrl-enter'?(e.ctrlKey||e.metaKey):(!e.ctrlKey&&!e.metaKey);
  if(submit){e.preventDefault();if(!e.repeat&&!$('#send').disabled)$('#composer').requestSubmit();}
};
$('#settingsForm>p').textContent='勾选后使用 Windows 当前用户加密保存在本机，重启自动读取。留空保留当前密钥；取消勾选后仅在本次运行使用。';
const rememberLabel=document.createElement('label'),rememberKey=document.createElement('input');rememberLabel.className='autoMemoryToggle';rememberKey.type='checkbox';rememberKey.id='rememberKey';rememberLabel.append(rememberKey,document.createTextNode('记住 API Key（Windows 本机加密）'));$('#settingsError').before(rememberLabel);
const clearKey=document.createElement('button');clearKey.type='button';clearKey.textContent='清除已保存密钥';clearKey.className='danger';$('#settingsForm .actions').append(clearKey);
const testConnection=document.createElement('button');testConnection.type='button';testConnection.textContent='测试已保存的连接';$('#settingsForm .actions').append(testConnection);
const testHint=document.createElement('p');testHint.className='muted';testHint.textContent='连接测试会发送一条简短请求到 DeepSeek，产生少量用量，不写入聊天或记忆。修改密钥后请先保存。';$('#settingsForm .actions').before(testHint);
testConnection.onclick=async()=>{if(savingSettings)return;settingsSaving(true);$('#settingsError').textContent='正在测试 DeepSeek，最多等待约 30 秒…';try{const result=await api('settings/test','POST',{});$('#settingsError').textContent=`连接成功 · ${result.model} · ${(result.elapsedMs/1000).toFixed(1)} 秒`;}catch(e){$('#settingsError').textContent=e.message;}finally{settingsSaving(false);}};
let savingSettings=false;
$('#settings').onclick=guarded(async()=>{const s=await api('settings');$('#apiKey').value='';rememberKey.checked=s.remembered;rememberKey.disabled=!s.secureStorageSupported;$('#settingsError').textContent=s.warning||'';$('#config').showModal();});
async function keyStatus(){const s=await api('settings');$('#keyStatus').textContent=s.warning|| (s.configured?(s.remembered?'● API Key 已配置 · 本机加密保存':'● API Key 已配置 · 本次运行'):'○ 尚未配置 API Key');}
function settingsSaving(value){savingSettings=value;$('#settingsForm').querySelectorAll('button,input').forEach(el=>el.disabled=value);}
$('#config').addEventListener('cancel',e=>{if(savingSettings)e.preventDefault();});
$('#settingsForm').onsubmit=async e=>{e.preventDefault();if(savingSettings)return;settingsSaving(true);try{await api('settings','PUT',{apiKey:$('#apiKey').value,remember:rememberKey.checked,keepCurrent:true});$('#apiKey').value='';$('#config').close();await keyStatus();notice('模型设置已更新');}catch(e){$('#settingsError').textContent=e.message;}finally{settingsSaving(false);}};
clearKey.onclick=async()=>{if(savingSettings)return;settingsSaving(true);try{await api('settings','DELETE');$('#apiKey').value='';rememberKey.checked=false;$('#settingsError').textContent='已清除本机保存和当前运行中的密钥。若启动环境设置了 DEEPSEEK_API_KEY，下次启动仍会读取该环境变量。';await keyStatus();}catch(e){$('#settingsError').textContent=e.message;}finally{settingsSaving(false);}};
let chatBackup=null,chatImportBusy=false;
$('#importChat').onclick=()=>{
  if(!roles.length){notice('请先创建或导入一个角色，再恢复聊天。');return;}
  chatBackup=null;$('#chatImportForm').reset();$('#chatImportRole').disabled=false;$('#chatBackupInfo').textContent='';$('#chatImportError').textContent='';$('#restoreChat').disabled=true;
  $('#chatImportRole').replaceChildren(...roles.map(r=>{const option=document.createElement('option');option.value=r.id;option.textContent=r.name;return option;}));
  if(selected&&roles.some(r=>r.id===selected))$('#chatImportRole').value=selected;
  $('#chatImportDialog').showModal();
};
$('#chatBackupFile').onchange=async e=>{
  chatBackup=null;$('#restoreChat').disabled=true;$('#chatImportError').textContent='';$('#chatBackupInfo').textContent='';
  try{
    const file=e.target.files[0];if(!file)return;
    if(file.size>6000000)throw new Error('聊天备份不能超过 6 MB');
    let parsed;try{parsed=JSON.parse((await file.text()).replace(/^\uFEFF/,''));}catch{throw new Error('JSON 格式无效，请选择 Muse 导出的聊天备份');}
    if(parsed?.schemaVersion!==1||!Array.isArray(parsed.messages)||typeof parsed.title!=='string')throw new Error('这不是 Muse JSON 聊天备份，请勿选择角色卡或 Markdown 文件');
    if(file!==e.target.files[0])return;
    chatBackup=parsed;if(isGroup(parsed)){$('#chatImportRole').value=parsed.characterId;$('#chatImportRole').disabled=true;}else $('#chatImportRole').disabled=false;$('#chatBackupInfo').textContent=`${parsed.title} · ${parsed.messages.length} 条消息 · 原角色：${isGroup(parsed)?'聊天室 · '+parsed.participants.map(p=>p.name).join('、'):typeof parsed.characterName==='string'?parsed.characterName:'未知'}`;$('#restoreChat').disabled=false;
  }catch(error){$('#chatImportError').textContent=error.message;}
};
$('#chatImportForm').onsubmit=async e=>{
  e.preventDefault();if(!chatBackup||chatImportBusy)return;
  chatImportBusy=true;$('#restoreChat').disabled=true;$('#chatBackupFile').disabled=true;$('#chatImportRole').disabled=true;
  try{
    const result=await api('chats/import','POST',{characterId:$('#chatImportRole').value,chat:chatBackup});
    chat=result.chat;selected=chat.characterId;$('#chatSearch').value='';++searchVersion;clearTimeout(searchTimer);
    $('#chatImportDialog').close();await refresh();notice(result.duplicate?'这份备份已导入，已打开现有聊天':'聊天已恢复，可以继续对话');
  }catch(error){$('#chatImportError').textContent=error.message;}
  finally{chatImportBusy=false;$('#restoreChat').disabled=!chatBackup;$('#chatBackupFile').disabled=false;$('#chatImportRole').disabled=isGroup(chatBackup);}
};
$('#chatImportDialog').addEventListener('cancel',e=>{if(chatImportBusy)e.preventDefault();});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(b.dataset.close==='chatImportDialog'&&chatImportBusy||b.dataset.close==='memoryImportDialog'&&memoryImportBusy)return;$('#'+b.dataset.close).close();});
await guarded(async()=>{
  const previous=readLocal(lastContextKey);await refresh();
  if(previous?.startsWith('chat:')){
    try{chat=await api(`chats/${previous.slice(5)}`);selected=chat.characterId;render();}
    catch{writeLocal(lastContextKey,null);}
  }else if(previous?.startsWith('role:')&&roles.some(r=>r.id===previous.slice(5))){selected=previous.slice(5);render();}
  await keyStatus();if($('#message').value)notice('已恢复未发送的草稿');
})();
window.addEventListener('muse-role-aliases',event=>{
  if(sending||editing||document.querySelector('dialog[open]'))return;
  const alias=event.detail.find(m=>m.from===selected);if(!alias)return;
  selected=alias.to;
  guarded(async()=>{if(chat){chat=await api(`chats/${chat.id}`);selected=chat.characterId;}await refresh();saveDraft();notice('同名角色已合并，聊天和记忆已归入同一角色。');})();
});
let lanRevision=null,qqRevision=null,lanRefreshing=false;
setInterval(async()=>{
  if(lanRefreshing||document.hidden||sending||editing||document.querySelector('dialog[open]')||$('#message').value)return;
  lanRefreshing=true;
  try{
    const [state,qqState]=await Promise.all([api('lan-sync'),api('qq/activity')]);
    if(lanRevision!==null&&state.revision!==lanRevision||qqRevision!==null&&qqState.revision!==qqRevision||qqState.chatId&&!chats.some(c=>c.id===qqState.chatId)){
      const id=chat?.id,updated=id?await api(`chats/${id}`).catch(()=>null):null;
      if(!sending&&chat?.id===id&&!document.querySelector('dialog[open]')){if(id){chat=updated;if(chat)selected=chat.characterId;}await refresh();}
    }
    lanRevision=state.revision;
    qqRevision=qqState.revision;
  }catch{}finally{lanRefreshing=false;}
},7000);
