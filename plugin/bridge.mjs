// SPDX-License-Identifier: GPL-3.0-or-later
import {randomBytes,timingSafeEqual} from 'node:crypto';
const secret=()=>randomBytes(24).toString('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function installBridge(ctx){
  let pairing=null,token=null;const grants=new Map(),calls=new Map();
  const revoke=()=>{token=null;pairing=null;grants.clear();for(const c of calls.values())c.abort?.abort();};
  ctx.effect(()=>revoke);
  ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/muse-multi-agent/bridge',handler:async(req,res)=>{
    const send=(code,data)=>{if(!res.destroyed){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}};
    try{
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return send(403,{error:'仅允许本机连接'});
      const action=new URL(req.url,'http://localhost').pathname.split('/').at(-1);
      if(req.method!=='POST')return send(405,{error:'仅支持 POST'});
      let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>100000)return send(413,{error:'请求过大'});}
      const body=JSON.parse(raw||'{}');
      if(action==='pair-code'||action==='revoke-ui'){
        if(req.headers['x-muse-ui']!=='1'||req.headers.origin&&req.headers.origin!=='dsh-app://app')return send(403,{error:'请从 DSH 操作'});
        if(action==='revoke-ui'){revoke();return send(200,{ok:true});}
        pairing={code:secret(),expires:Date.now()+120000};return send(200,{code:`${ctx.webServer.port}:${pairing.code}`,expires:pairing.expires});
      }
      if(action==='claim'){
        if(!pairing||Date.now()>pairing.expires||!equal(body.code,pairing.code))return send(403,{error:'配对码无效或已过期'});
        revoke();token=secret();return send(200,{token,device:'本机 DSH',protocolVersion:1});
      }
      if(!token||!equal(req.headers.authorization,`Bearer ${token}`))return send(401,{error:'配对已失效，请重新配对'});
      if(action==='revoke'){revoke();return send(200,{ok:true});}
      if(action==='catalog'){
        const agents=ctx.agents.list().map(a=>({id:a.id,name:String(a.session?.meta?.title||a.id),tools:ctx.tools.schemas(a).filter(t=>!t.name.startsWith('muse_'))}));
        return send(200,{agents});
      }
      if(action==='grant'){
        const agent=ctx.agents.get(body.agentId);if(!agent||typeof body.roleId!=='string'||!Array.isArray(body.tools)||body.tools.length>64)throw Error('角色绑定无效');
        const schemas=ctx.tools.schemas(agent).filter(t=>!t.name.startsWith('muse_'));if(body.tools.some(n=>!schemas.some(t=>t.name===n)))throw Error('工具目录已变化');
        for(const c of calls.values())if(c.roleId===body.roleId)c.abort?.abort();
        grants.set(body.roleId,{agent,tools:new Set(body.tools),schemas:new Map(schemas.map(t=>[t.name,JSON.stringify(t)]))});return send(200,{ok:true});
      }
      if(action==='cancel') {const c=calls.get(body.callId);if(c?.roleId===body.roleId)c.abort?.abort();return send(200,{ok:true});}
      if(action==='execute'){
        if(typeof body.callId!=='string'||body.callId.length>100||typeof body.chatId!=='string')throw Error('调用标识无效');
        if(calls.has(body.callId))return send(409,{error:'调用已经提交，不自动重复执行'});
        if(calls.size>=1000)throw Error('本次运行调用记录已满，请在任务结束后重启 DSH 并重新配对');
        const g=grants.get(body.roleId);if(!g||ctx.agents.get(g.agent.id)!==g.agent||!g.tools.has(body.tool)||!ctx.tools.schemas(g.agent).some(t=>t.name===body.tool))return send(403,{error:'此角色未授权该工具，或 DSH 会话已关闭'});
        if(JSON.stringify(ctx.tools.schemas(g.agent).find(t=>t.name===body.tool))!==g.schemas.get(body.tool))return send(403,{error:'工具定义已改变，请重新审核授权'});
        const abort=new AbortController(),record={roleId:body.roleId,abort};calls.set(body.callId,record);
        const disconnected=()=>{if(!res.writableEnded)abort.abort();};res.on('close',disconnected);
        try{
          const result=await g.agent.runMaintenance(async signal=>ctx.tools.execute({agent:g.agent,callId:body.callId,name:body.tool,arguments:body.args,signal:AbortSignal.any([signal,abort.signal,AbortSignal.timeout(120000)])}));
          record.result=result;return send(200,{result});
        }finally{res.off('close',disconnected);delete record.abort;}
      }
      return send(404,{error:'未知接口'});
    }catch(error){return send(400,{error:error instanceof SyntaxError?'无效请求':String(error.message).slice(0,400)});}
  }}));
}
