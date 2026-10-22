// SPDX-License-Identifier: GPL-3.0-or-later
window.__ModuleLoader__.load({id:'dsh-plugin-muse-multi-agent',factory:(require)=>{
  const React=require('react');
  function NativeMuse({sessionId}){
    const [state,setState]=React.useState(null),[selected,setSelected]=React.useState(''),[error,setError]=React.useState(''),[saving,setSaving]=React.useState(false);
    const epoch=React.useRef(0);
    async function api(action,extra={}){
      const r=await fetch('muse-multi-agent/native/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Muse-UI':'1'},body:JSON.stringify({sessionId,...extra}),signal:AbortSignal.timeout(15000)});
      const data=await r.json().catch(()=>{throw Error('Muse 原生聊天插件尚未就绪，请重启 DSH 后重试');});if(!r.ok)throw Error(data.error||'连接 Muse 失败');return data;
    }
    React.useEffect(()=>{
      const version=++epoch.current;let active=true;
      setState(null);setError('');setSelected('');setSaving(false);
      const load=async()=>{if(!sessionId)return;try{const data=await api('state');if(active&&epoch.current===version){setState(data);setError(data.error||'');setSelected(old=>old||data.binding?.roleId||data.roles.find(r=>r.name==='桃子')?.id||data.roles[0]?.id||'');}}catch(e){if(active&&epoch.current===version)setError(e.message);}};
      void load();const timer=setInterval(load,10000);return()=>{active=false;clearInterval(timer);};
    },[sessionId]);
    async function bind(){const version=epoch.current;setSaving(true);setError('');try{const data=await api('bind',{roleId:selected});if(version===epoch.current)setState(data);}catch(e){if(version===epoch.current)setError(e.message);}finally{if(version===epoch.current)setSaving(false);}}
    const style={font:'inherit',color:'inherit',background:'transparent',border:'1px solid currentColor',borderRadius:6,padding:'3px 6px'};
    return React.createElement('div',{style:{fontSize:12,display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',padding:'8px 12px',margin:'0 auto 6px',width:'calc(100% - 32px)',maxWidth:'var(--dsh-composer-card-max-width,850px)',boxSizing:'border-box',borderRadius:10,background:'var(--dsw-alias-background-primary,#202020)'},'aria-label':'Muse 原生聊天'},
      state?.binding?React.createElement('span',{title:'本对话固定绑定此角色；切换角色请新建对话'},'✦ '+state.binding.roleName+(state.binding.unavailable?' · 绑定不可用':' · 已绑定 Muse')):
      React.createElement(React.Fragment,null,
        React.createElement('select',{'aria-label':'选择 Muse 角色',value:selected,onChange:e=>setSelected(e.target.value),disabled:!state||saving,style},
          !state?React.createElement('option',{value:''},'连接 Muse…'):state.roles.map(r=>React.createElement('option',{key:r.id,value:r.id,style:{color:'#111',background:'#fff'}},r.name))),
        React.createElement('button',{type:'button',style,onClick:bind,disabled:saving||!selected||!sessionId},saving?'绑定中…':'在此对话')),
      error?React.createElement('span',{role:'status',style:{color:'#f0a88b',maxWidth:450}},error):null);
  }
  function MuseEntry({open}){
    const [status,setStatus]=React.useState('点击检查 Muse 连接');
    const [checking,setChecking]=React.useState(false);
    async function check(){setChecking(true);try{
      const r=await fetch('muse-multi-agent/status',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const data=await r.json();
      setStatus(data.connected?'Muse 已运行 · 配对后按角色授权工具':'Muse 自动启动失败，请重新连接或手动运行 start-muse.cmd');
    }catch{setStatus('连接检查失败，请确认插件已加载');}finally{setChecking(false);}}
    return React.createElement('div',{style:{padding:'8px',width:'100%',fontSize:'12px',overflowWrap:'anywhere'}},
      React.createElement('button',{type:'button',onClick:open,style:{font:'inherit',color:'inherit',background:'transparent',border:0,display:'block',padding:'6px 0',fontWeight:600,cursor:'pointer'}},'✦ Muse Multi-Agent'),
      React.createElement('button',{type:'button',onClick:check,disabled:checking,style:{font:'inherit',color:'inherit',background:'transparent',border:'1px solid currentColor',borderRadius:6,padding:'4px 8px'}},checking?'检查中…':'检查连接'),
      React.createElement('p',{role:'status',style:{margin:'6px 0',opacity:.75}},status));
  }
  function MusePanel({close}){
    const frame=React.useRef(null);
    React.useEffect(()=>{
      let active=true,pending=false;
      const receive=async e=>{
        if(e.source!==frame.current?.contentWindow||e.origin!=='http://127.0.0.1:3210'||e.data?.type!=='muse:pair-request'||typeof e.data.requestId!=='string'||e.data.requestId.length>100||pending)return;
        const source=e.source,requestId=e.data.requestId;pending=true;
        try{
          const r=await fetch('muse-multi-agent/bridge/pair-code',{method:'POST',headers:{'Content-Type':'application/json','X-Muse-UI':'1'},body:'{}',signal:AbortSignal.timeout(15000)});
          const data=await r.json();if(!r.ok)throw Error();
          if(active&&source===frame.current?.contentWindow)source.postMessage({type:'muse:pair-result',requestId,code:data.code},'http://127.0.0.1:3210');
        }catch{if(active&&source===frame.current?.contentWindow)source.postMessage({type:'muse:pair-result',requestId,error:true},'http://127.0.0.1:3210');}
        finally{pending=false;}
      };
      window.addEventListener('message',receive);return()=>{active=false;window.removeEventListener('message',receive);};
    },[]);
    const [code,setCode]=React.useState('');
    async function pairing(action){try{const r=await fetch('muse-multi-agent/bridge/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Muse-UI':'1'},body:'{}'});const d=await r.json();if(!r.ok)throw Error(d.error);setCode(d.code||'连接已撤销');}catch(e){setCode(e.message);}}
    const [status,setStatus]=React.useState('checking'),[retry,setRetry]=React.useState(0);
    React.useEffect(()=>{let active=true;fetch('muse-multi-agent/status',{signal:AbortSignal.timeout(15000)}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{if(active)setStatus(d.connected?'ready':'offline');}).catch(()=>{if(active)setStatus('offline');});return()=>{active=false;};},[retry]);
    return React.createElement('section',{style:{height:'100%',minHeight:0,display:'flex',flexDirection:'column',background:'var(--dsw-alias-background-primary,#202020)'}},
      React.createElement('header',{style:{display:'flex',alignItems:'center',gap:12,padding:'10px 16px'}},React.createElement('strong',null,'Muse Multi-Agent'),React.createElement('button',{type:'button',onClick:close,style:{marginLeft:'auto'}},'返回 DSH')),
      React.createElement('details',{style:{padding:'0 16px 8px'}},React.createElement('summary',null,'手动设备配对（备用）'),React.createElement('button',{onClick:()=>pairing('pair-code')},'生成配对码（2 分钟有效）'),React.createElement('button',{onClick:()=>pairing('revoke-ui')},'撤销连接'),React.createElement('input',{readOnly:true,value:code,'aria-label':'Muse 配对码',style:{width:'100%'}}),React.createElement('small',null,'下方 Muse 设置 → DSH 插件与工具中可一键连接；也可以复制配对码手动连接。重启后需重新配对。')),
      status==='ready'?React.createElement('iframe',{ref:frame,title:'Muse 聊天面板',src:'http://127.0.0.1:3210/?embed=dsh',allow:'clipboard-write',sandbox:'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads',style:{border:0,width:'100%',flex:1,minHeight:0,background:'#202020'}}):React.createElement('div',{style:{padding:24}},React.createElement('p',{role:'status'},status==='checking'?'正在自动启动并连接 Muse…':'Muse 自动启动失败，请重新连接；也可以手动运行 start-muse.cmd。'),React.createElement('button',{type:'button',onClick:()=>{setStatus('checking');setRetry(n=>n+1);}},'重新连接')));
  }
  return {inject:['slots','layout'],apply(ctx){
    ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'muse-native-chat',order:30,inject:sessionId=>({sessionId})},NativeMuse));
    ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'muse-multi-agent',inject:()=>({close:()=>ctx.layout.selectPanel(null)})},MusePanel));
    ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'muse-multi-agent',order:50,inject:()=>({open:()=>ctx.layout.selectPanel('muse-multi-agent')})},MuseEntry));
  }};
}});
