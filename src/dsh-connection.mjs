// SPDX-License-Identifier: GPL-3.0-or-later
export class DshConnection{
  constructor(){this.endpoint=null;this.token=null;this.grants=new Map();this.controllers=new Set();}
  reset(){for(const c of this.controllers)c.abort();this.controllers.clear();this.endpoint=null;this.token=null;this.grants.clear();}
  async request(action,body={},signal){
    if(!this.token)throw Error('请先配对 DSH');
    const r=await fetch(`${this.endpoint}/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.token}`},body:JSON.stringify(body),redirect:'error',signal:signal||AbortSignal.timeout(5000)});
    if(r.status===401){this.reset();throw Error('DSH 配对已失效，请重新配对');}
    const data=await r.json();if(!r.ok)throw Error(data.error||'DSH 请求失败');return data;
  }
  async pair(code){
    const match=/^(\d{1,5}):([a-f0-9]{48})$/.exec(code||'');if(!match||+match[1]<1||+match[1]>65535)throw Error('请粘贴 DSH 显示的完整配对码');
    const endpoint=`http://127.0.0.1:${match[1]}/muse-multi-agent/bridge`;
    // Revoking this same bridge would also invalidate the newly issued pair code.
    // A successful claim already revokes the previous device on the host.
    if(this.token&&this.endpoint!==endpoint)await this.revoke();
    const r=await fetch(endpoint+'/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:match[2]}),redirect:'error',signal:AbortSignal.timeout(5000)});const data=await r.json();if(!r.ok||! /^[a-f0-9]{48}$/.test(data.token||''))throw Error('配对失败，配对码可能过期');
    this.reset();this.endpoint=endpoint;this.token=data.token;return {paired:true};
  }
  async revoke(){try{if(this.token)await this.request('revoke');}finally{this.reset();}}
  async catalog(){return this.request('catalog');}
  async grant(roleId,agentId,tools,allTools=false){
    const result=await this.request('grant',{roleId,agentId,tools,allTools});
    if(allTools&&result.allTools!==true)throw Error('当前 DSH Muse 插件不支持自动接入，请更新插件并重启 DSH');
    this.grants.set(roleId,{agentId,tools:[...tools],allTools});
  }
  async tools(roleId){const g=this.grants.get(roleId);if(!g||!g.allTools&&!g.tools.length)return [];const {agents}=await this.catalog();const a=agents.find(a=>a.id===g.agentId);if(!a)throw Error('绑定的 DSH 会话已关闭，请重新授权');return a.tools.filter(t=>!t.name.startsWith('muse_')&&(g.allTools||g.tools.includes(t.name)));}
  async invoke(roleId,chatId,callId,tool,args,signal){
    const g=this.grants.get(roleId);if(!g||!g.allTools&&!g.tools.includes(tool)||typeof tool!=='string'||tool.startsWith('muse_'))throw Error('此角色未授权该工具');
    const controller=new AbortController();this.controllers.add(controller);
    try{return (await this.request('execute',{roleId,chatId,callId,tool,args},AbortSignal.any([controller.signal,signal,AbortSignal.timeout(125000)]))).result;}
    finally{this.controllers.delete(controller);}
  }
}
