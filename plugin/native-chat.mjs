// SPDX-License-Identifier: GPL-3.0-or-later
const textOf=m=>(m?.content||[]).filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n');
export function transcript(events){
  return events.flatMap(e=>{
    if(e.type==='user/message'&&e.data.source?.kind==='user'){
      const content=textOf(e.data);return content.trim()?[{seq:e.seq,role:'user',content,createdAt:e.time}]:[];
    }
    if(e.type==='assistant/message'){
      const content=textOf(e.data.message);if(!content.trim())return [];
      const finish=e.data.stream?.findLast(c=>c.type==='chunk'&&c.chunk?.type==='finish')?.chunk.reason?.kind;
      return [{seq:e.seq,role:'assistant',content,createdAt:e.time,finishReason:e.data.interrupted?'cancelled':finish==='max-tokens'?'length':'stop'}];
    }
    return [];
  });
}

export function installNativeChat(ctx,{request=fetch,base='http://127.0.0.1:3210/'}={}){
  const bindings=new Map(),queries=new Map(),queues=new Map(),errors=new Map(),probes=new Set();let disposed=false;
  async function call(action,body,signal){
    const response=await request(base+'api/dsh/native/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Muse 原生聊天连接失败');return data;
  }
  function serial(id,fn){
    const prior=queues.get(id)||Promise.resolve(),job=prior.catch(()=>{}).then(()=>{if(disposed)throw Error('Muse 插件已卸载');return fn();});
    queues.set(id,job);job.finally(()=>{if(queues.get(id)===job)queues.delete(id);}).catch(()=>{});return job;
  }
  async function state(id){return call('state',{sessionId:id});}
  async function binding(id){
    if(!bindings.has(id)){
      const view=await ctx.sessionQuery.readSession(id);
      const marker=view.events.findLast(e=>e.type==='muse/native-bound'&&e.data.sessionId===id);
      if(!marker){bindings.set(id,null);return null;}
      const result=await state(id);
      if(!result.binding||result.binding.roleId!==marker.data.roleId){bindings.delete(id);throw Error('Muse 原生聊天绑定尚未完成或已改变，请重新连接');}
      bindings.set(id,result.binding);
    }
    const b=bindings.get(id);if(b?.unavailable)throw Error('Muse 绑定的角色或聊天已删除，请先恢复');return b;
  }
  async function sync(id,signal){
    const b=await binding(id);if(!b)return;
    const view=await ctx.sessionQuery.readSession(id);signal?.throwIfAborted();
    const remaining=view.events.filter(e=>e.seq>b.throughSeq);
    for(let offset=0;offset<remaining.length;offset+=200){
      const events=remaining.slice(offset,offset+200),throughSeq=events.at(-1).seq;
      const completedTurn=events.filter(e=>e.type==='turn/end'&&e.data.reason?.kind==='completed').at(-1)?.data.turn||0;
      await call('sync',{sessionId:id,roleId:b.roleId,messages:transcript(events),throughSeq,completedTurn},signal);
      b.throughSeq=throughSeq;
    }
    errors.delete(id);
  }
  ctx.on('agent/inbox/claimed',({agent,message,turn})=>{
    if(message.source?.kind!=='user')return;
    const text=textOf(message);if(!text.trim())return;
    const old=queries.get(agent.id);queries.set(agent.id,{turn,text:old?.turn===turn?old.text+'\n'+text:text});
  });
  ctx.on('system-prompt/assemble',async(assembly,context,next)=>{
    const result=await next();const agent=context.agent;if(!agent)return result;
    if(probes.has(agent.id))return {...result,sections:[...result.sections,{name:'muse:probe',text:'',interpolate:false}]};
    return serial(agent.id,async()=>{
      const b=await binding(agent.id);if(!b)return result;
      await sync(agent.id,context.signal);
      const snapshot=await call('context',{sessionId:agent.id,roleId:b.roleId,query:queries.get(agent.id)?.text||''},context.signal);
      context.signal?.throwIfAborted();
      // Replace only deployment persona slots; retain DSH tools, approvals and runtime rules.
      return {...result,sections:[
        {name:'muse:persona',text:snapshot.persona+'\n\n你正在 DSH 原生聊天中以此 Muse 角色与同一用户交谈。延续人设、称呼、语气和已有关系；结合以下记忆自然接话。不编造没有依据的经历。',interpolate:false},
        ...result.sections.filter(s=>!['deployment:persona-prefix','deployment:persona-suffix'].includes(s.name)),
        {name:'muse:memory',text:snapshot.memory,interpolate:false}
      ]};
    });
  });
  async function checkPromptMode(agent){
    probes.add(agent.id);
    try{
      const result=await agent.ctx.systemPrompt.assemble({agent,scope:agent});
      if(!result.sections.some(s=>s.name==='muse:probe'))throw Error('此 DSH 模式锁定了完整提示词；请在标准模式新建对话后绑定 Muse 角色');
    }finally{probes.delete(agent.id);}
  }
  ctx.on('agent/pre-step',async({agent},next)=>{if(bindings.get(agent.id))await checkPromptMode(agent);return next();});
  function queueSync(id){
    void serial(id,()=>sync(id)).catch(e=>{errors.set(id,String(e.message));});
  }
  ctx.on('session/event',(session,event)=>{if(event.type==='turn/end'&&bindings.get(session.id))queueSync(session.id);});
  // Before another turn, sync() also recovers a write interrupted by host/service shutdown.
  const retry=setInterval(()=>{for(const id of errors.keys())if(!queues.has(id))queueSync(id);},15000);retry.unref?.();
  ctx.effect(()=>()=>{disposed=true;clearInterval(retry);bindings.clear();queries.clear();});
  ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/muse-multi-agent/native',handler:async(req,res)=>{
    const send=(code,data)=>{if(!res.destroyed){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}};
    try{
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers['x-muse-ui']!=='1'||req.headers.origin&&req.headers.origin!=='dsh-app://app')return send(403,{error:'请从 DSH 主聊天框操作'});
      if(req.method!=='POST')return send(405,{error:'仅支持 POST'});
      let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>10000)return send(413,{error:'请求过大'});}
      const body=JSON.parse(raw||'{}'),id=body.sessionId;
      if(typeof id!=='string'||!id||id.length>200)throw Error('请先新建或打开一个 DSH 对话');
      const action=new URL(req.url,'http://localhost').pathname.split('/').at(-1);
      if(action==='state'){
        const result=await serial(id,()=>state(id));
        if(result.binding&&ctx.agents.get(id)?.status!=='running')queueSync(id);
        return send(200,{...result,error:errors.get(id)||null});
      }
      if(action==='bind'){
        const agent=ctx.agents.get(id);if(!agent)throw Error('请先打开此 DSH 对话，再绑定角色');
        if(agent.status==='running')throw Error('请等待当前回复结束再绑定角色');
        return send(200,await agent.runMaintenance(()=>serial(id,async()=>{
          await checkPromptMode(agent);
          const current=await state(id);
          const view=await ctx.sessionQuery.readSession(id);
          const marker=view.events.findLast(e=>e.type==='muse/native-bound'&&e.data.sessionId===id);
          if(marker&&marker.data.roleId!==body.roleId)throw Error('此对话已选定其他 Muse 角色，请新建对话');
          if(!current.binding){
            if(view.session.isSeeded||view.events.some(e=>['user/message','assistant/message'].includes(e.type)))throw Error('为避免混入旧对话，请新建空白 DSH 会话后绑定 Muse 角色');
          }
          if(!marker){agent.session.append('muse/native-bound',{sessionId:id,roleId:body.roleId});bindings.delete(id);}
          const result=await call('bind',{sessionId:id,roleId:body.roleId});bindings.set(id,result.binding);return result;
        })));
      }
      return send(404,{error:'未知接口'});
    }catch(e){send(400,{error:String(e.message).slice(0,300)});}
  }}));
  return {sync:id=>serial(id,()=>sync(id))};
}
