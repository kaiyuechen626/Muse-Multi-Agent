// SPDX-License-Identifier: GPL-3.0-or-later
window.__ModuleLoader__.load({id:'dsh-plugin-muse-multi-agent',factory:(require)=>{
  const React=require('react');
  function MuseEntry({open}){
    const [status,setStatus]=React.useState('点击检查 Muse 连接');
    const [checking,setChecking]=React.useState(false);
    async function check(){setChecking(true);try{
      const r=await fetch('muse-multi-agent/status',{signal:AbortSignal.timeout(3500)});if(!r.ok)throw Error();const data=await r.json();
      setStatus(data.connected?'Muse 已运行 · 配对后按角色授权工具':'Muse 未启动，请先运行 start-muse.cmd');
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
          const r=await fetch('muse-multi-agent/bridge/pair-code',{method:'POST',headers:{'Content-Type':'application/json','X-Muse-UI':'1'},body:'{}',signal:AbortSignal.timeout(3500)});
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
    React.useEffect(()=>{let active=true;fetch('muse-multi-agent/status',{signal:AbortSignal.timeout(3500)}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{if(active)setStatus(d.connected?'ready':'offline');}).catch(()=>{if(active)setStatus('offline');});return()=>{active=false;};},[retry]);
    return React.createElement('section',{style:{height:'100%',minHeight:0,display:'flex',flexDirection:'column',background:'var(--dsw-alias-background-primary,#202020)'}},
      React.createElement('header',{style:{display:'flex',alignItems:'center',gap:12,padding:'10px 16px'}},React.createElement('strong',null,'Muse Multi-Agent'),React.createElement('button',{type:'button',onClick:close,style:{marginLeft:'auto'}},'返回 DSH')),
      React.createElement('details',{style:{padding:'0 16px 8px'}},React.createElement('summary',null,'手动设备配对（备用）'),React.createElement('button',{onClick:()=>pairing('pair-code')},'生成配对码（2 分钟有效）'),React.createElement('button',{onClick:()=>pairing('revoke-ui')},'撤销连接'),React.createElement('input',{readOnly:true,value:code,'aria-label':'Muse 配对码',style:{width:'100%'}}),React.createElement('small',null,'下方 Muse 设置 → DSH 插件与工具中可一键连接；也可以复制配对码手动连接。重启后需重新配对。')),
      status==='ready'?React.createElement('iframe',{ref:frame,title:'Muse 聊天面板',src:'http://127.0.0.1:3210/?embed=dsh',allow:'clipboard-write',sandbox:'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads',style:{border:0,width:'100%',flex:1,minHeight:0,background:'#202020'}}):React.createElement('div',{style:{padding:24}},React.createElement('p',{role:'status'},status==='checking'?'正在连接 Muse…':'Muse 未启动或连接失败，请先运行 start-muse.cmd。'),React.createElement('button',{type:'button',onClick:()=>{setStatus('checking');setRetry(n=>n+1);}},'重新连接')));
  }
  return {inject:['slots','layout'],apply(ctx){
    ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'muse-multi-agent',inject:()=>({close:()=>ctx.layout.selectPanel(null)})},MusePanel));
    ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'muse-multi-agent',order:50,inject:()=>({open:()=>ctx.layout.selectPanel('muse-multi-agent')})},MuseEntry));
  }};
}});
