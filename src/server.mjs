// SPDX-License-Identifier: GPL-3.0-or-later
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { character, importCard, exportCard, substitute } from './characters.mjs';
import { complete } from './provider.mjs';
import { importMusePackage } from './muse-package.mjs';
import { memoryContextSnapshot, changeMemory, exportMemory, mergeMemoryBackup } from './memory.mjs';
import { chatSummary,exportChat,importChat } from './chat-management.mjs';
import { extractMemory,appendAutomaticMemory } from './automatic-memory.mjs';
import { reviewMemories,mergeReviewedMemories } from './memory-review.mjs';
import { KeyVault } from './key-vault.mjs';
import {generateSummary,summaryHistory,needsSummary,validSummary} from './chat-summary.mjs';
import {exportFullBackup,previewFullBackup,restoreFullBackup} from './full-backup.mjs';
import {addReplyVersion,selectReplyVersion} from './reply-versions.mjs';
import {DshConnection} from './dsh-connection.mjs';
import {completeWithTools} from './tool-completion.mjs';
const web = new URL('../web/',import.meta.url);
export async function createApp({dataDir=fileURLToPath(new URL('../data/',import.meta.url)), provider=complete,memoryExtractor=provider===complete?extractMemory:null}={}) {
  const store = new Store(dataDir); await store.init();
  const dsh=new DshConnection();
  const busy = new Map(); let apiKey = process.env.DEEPSEEK_API_KEY || '';
  const keyVault=new KeyVault(dataDir);let remembered=false,keyWarning='',settingsBusy=false;
  let connectionTesting=false;
  try{const saved=await keyVault.load();if(saved){apiKey=saved;remembered=true;}}catch(e){keyWarning=e.message;}
  const memoryWrites=new Set(),chatImports=new Set();
  const automaticJobs=new Map(),automaticState=new Map();
  const roleChanges=new Set();
  async function activeRole(id){const role=await store.get('characters',id);return role&&!role.deletedAt&&!roleChanges.has(id)?role:null;}
  let backupBusy=false,activeApi=0;
  const memoryView=(m,id)=>({...m,records:m.records.filter(r=>!r.deletedAt),automatic:{enabled:m.automaticEnabled!==false,...(automaticState.get(id)||m.lastAutomatic||{status:'idle'})}});
  async function withMemoryLock(id,fn){
    while(memoryWrites.has(id))await new Promise(resolve=>setTimeout(resolve,10));
    memoryWrites.add(id);try{return await fn();}finally{memoryWrites.delete(id);}
  }
  function remember(roleId,chatId,history,key){
    if(!memoryExtractor)return;
    const prior=automaticJobs.get(roleId)||Promise.resolve();
    const job=prior.catch(()=>{}).then(async()=>{
      if(!await activeRole(roleId))return;
      const memory=await store.get('memories',roleId)||{id:roleId,characterId:roleId,records:[]};
      if(memory.automaticEnabled===false)return;
      automaticState.set(roleId,{status:'running'});
      let candidates,error;
      try{candidates=await memoryExtractor(history,memory,key);}catch{error='自动记忆分析失败，本轮未保存；聊天回复不受影响。';}
      await withMemoryLock(roleId,async()=>{
        if(!await activeRole(roleId))return;
        let current=await store.get('memories',roleId)||{id:roleId,characterId:roleId,records:[]};
        if(current.automaticEnabled===false)return;
        let added=0;
        if(!error){const result=appendAutomaticMemory(current,candidates,{chatId,messageId:history.findLast(m=>m.role==='user')?.id});current=result.memory;added=result.added;}
        current.lastAutomatic={status:error?'error':'done',added,at:Date.now(),...(error?{error}:{})};
        await store.put('memories',current);
      });
    }).catch(()=>{automaticState.set(roleId,{status:'error',error:'自动记忆保存失败，请检查本地数据目录。'});}).finally(()=>{
      if(automaticState.get(roleId)?.status==='running')automaticState.delete(roleId);
      if(automaticJobs.get(roleId)===job)automaticJobs.delete(roleId);
    });
    automaticJobs.set(roleId,job);
  }
  const server = http.createServer(async (req,res) => {
    let tracked=false;
    const json = (code,value) => {
      if(res.destroyed||res.writableEnded)return;
      if(res.headersSent)return res.end(JSON.stringify({type:'error',error:value.error||'请求失败'})+'\n');
      res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value));
    };
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) return json(403,{error:'只允许本地同源访问'});
      const url = new URL(req.url,`http://${host}`), path = url.pathname;
      if (!path.startsWith('/api/')) {
        const files = {'/LICENSE':['../LICENSE','text/plain'],'/NOTICE':['../NOTICE','text/plain'],'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/dsh-settings.js':['dsh-settings.js','text/javascript'],'/png-card.js':['png-card.js','text/javascript'],'/message-format.js':['message-format.js','text/javascript'],'/style.css':['style.css','text/css']};
        if(req.method !== 'GET' || !files[path]) return json(404,{error:'未找到'});
        const ancestors=path==='/'&&url.searchParams.get('embed')==='dsh'?"dsh-app://app":"'none'";
        res.writeHead(200,{'Content-Type':`${files[path][1]}; charset=utf-8`,'Content-Security-Policy':`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors ${ancestors}`,'X-Content-Type-Options':'nosniff'});
        return res.end(await readFile(new URL(files[path][0],web)));
      }
      let body = {};
      if(path==='/api/health'&&req.method==='GET')return json(200,{app:'muse-multi-agent',schemaVersion:1});
      if(backupBusy)return json(409,{error:'正在处理完整备份，请稍后重试'});
      activeApi++;tracked=true;
      if(path==='/api/import/muse'&&req.method==='POST'){
        if(req.headers['content-type']!=='application/octet-stream')return json(415,{error:'请选择手机导出的角色包'});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>20000000)return json(413,{error:'手机角色包不能超过 20 MB'});chunks.push(chunk);}
        return json(200,importMusePackage(Buffer.concat(chunks)));
      }
      if (['POST','PUT'].includes(req.method) || (req.method==='DELETE'&&req.headers['content-type']?.startsWith('application/json'))) {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415,{error:'需要 JSON'});
        const max=path==='/api/backup'?64000000:7000000;
        const chunks=[]; let size=0; for await (const chunk of req) { size+=chunk.length; if(size>max) return json(413,{error:`文件过大（最大 ${max/1000000} MB）`}); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(400,{error:'无效 JSON'}); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400,{error:'请求必须为 JSON 对象'});
      }
      if(path==='/api/dsh'&&req.method==='GET')return json(200,{paired:!!dsh.token,grants:Object.fromEntries(dsh.grants)});
      if(path==='/api/dsh/pair'&&req.method==='POST')return json(200,await dsh.pair(body.code));
      if(path==='/api/dsh/revoke'&&req.method==='POST'){await dsh.revoke();return json(200,{ok:true});}
      if(path==='/api/dsh/catalog'&&req.method==='GET')return json(200,await dsh.catalog());
      if(path==='/api/dsh/grant'&&req.method==='POST'){
        if(!await activeRole(body.roleId))throw Error('角色不存在');
        if(typeof body.agentId!=='string'||!Array.isArray(body.tools)||body.tools.length>64||body.tools.some(t=>typeof t!=='string'))throw Error('工具授权无效');
        await dsh.grant(body.roleId,body.agentId,body.tools);return json(200,{ok:true});
      }
      if(path==='/api/backup'){
        if(!['GET','POST'].includes(req.method))return json(405,{error:'不支持的方法'});
        if(activeApi>1||busy.size||memoryWrites.size||automaticJobs.size)return json(409,{error:'请等待聊天生成或数据保存结束，再处理完整备份'});
        backupBusy=true;
        try{
          if(req.method==='GET'){const data=JSON.stringify(await exportFullBackup(store));if(Buffer.byteLength(data)>63000000)throw new Error('完整备份超过本版 63 MB 限制，请先使用单独导出');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="muse-full-backup.json"','Cache-Control':'no-store'});return res.end(data);}
          if(typeof body.preview!=='boolean')throw new Error('请先预览备份');
          if(body.preview){const {counts,exportedAt}=await previewFullBackup(store,body.backup);return json(200,{counts,exportedAt});}
          return json(200,{counts:await restoreFullBackup(store,body.backup)});
        }finally{backupBusy=false;}
      }
      if(path==='/api/settings/test'&&req.method==='POST'){
        if(connectionTesting)return json(409,{error:'连接测试正在进行'});
        if(!apiKey)return json(400,{error:'请先保存 API Key，再测试连接'});
        connectionTesting=true;const started=Date.now();
        try{
          await provider({name:'连接测试',model:'deepseek-chat',temperature:0,maxTokens:8},[{role:'user',content:'Reply OK.'}],apiKey,{signal:AbortSignal.timeout(30000)});
          return json(200,{ok:true,model:'deepseek-chat',elapsedMs:Date.now()-started});
        }finally{connectionTesting=false;}
      }
      if(path === '/api/settings') {
        if(req.method==='PUT'||req.method==='DELETE'){
          if(settingsBusy)return json(409,{error:'设置正在保存，请稍后重试'});
          settingsBusy=true;
          try{
            if(req.method==='DELETE'){await keyVault.clear();apiKey='';remembered=false;keyWarning='';}
            else{
              if(typeof body.apiKey!=='string'||body.apiKey.length>512||/[\r\n]/.test(body.apiKey)||('remember' in body&&typeof body.remember!=='boolean'))throw new Error('无效 API Key 设置');
              const next=body.apiKey.trim()||(body.keepCurrent===true?apiKey:'');
              if(body.remember===true){if(!next)throw new Error('请先填写 API Key');await keyVault.save(next);}
              else await keyVault.clear();
              apiKey=next;remembered=body.remember===true;keyWarning='';
            }
          }finally{settingsBusy=false;}
        }else if(req.method !== 'GET') return json(405,{error:'不支持的方法'});
        return json(200,{configured:!!apiKey,remembered,secureStorageSupported:keyVault.supported,warning:keyWarning});
      }
      if(path === '/api/import' && req.method === 'POST') return json(200,importCard(body));
      const roleExport=path.match(/^\/api\/characters\/([a-f0-9-]{36})\/export$/);
      if(roleExport&&req.method==='GET'){
        const role=await activeRole(roleExport[1]);if(!role)return json(404,{error:'角色不存在'});
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="muse-character-${role.id}.json"`,'Cache-Control':'no-store'});
        return res.end(JSON.stringify(exportCard(role),null,2));
      }
      const retrievalMatch=path.match(/^\/api\/characters\/([a-f0-9-]{36})\/memories\/retrieval$/);
      if(retrievalMatch&&req.method==='PUT'){
        const id=retrievalMatch[1];if(!await activeRole(id))return json(404,{error:'角色不存在'});if(typeof body.enabled!=='boolean')throw Error('检索开关无效');
        const memory=await withMemoryLock(id,async()=>{const m=await store.get('memories',id)||{id,characterId:id,records:[]};m.retrievalEnabled=body.enabled;await store.put('memories',m);return m;});return json(200,memoryView(memory,id));
      }
      if(path === '/api/characters') {
        if(req.method === 'GET') return json(200,(await store.list('characters')).filter(r=>!!r.deletedAt===(url.searchParams.get('trash')==='1')));
        if(req.method === 'POST') { const c = character(body); if(body.importCard) c.cardMetadata=importCard(body.importCard).character.cardMetadata; return json(201,await store.put('characters',c)); }
      }
      const automaticMatch=path.match(/^\/api\/characters\/([a-f0-9-]{36})\/memories\/automatic$/);
      if(automaticMatch&&req.method==='PUT'){
        const id=automaticMatch[1];if(!await activeRole(id))return json(404,{error:'角色不存在'});
        if(typeof body.enabled!=='boolean')throw new Error('自动记忆开关无效');
        const saved=await withMemoryLock(id,async()=>{
          const m=await store.get('memories',id)||{id,characterId:id,records:[]};m.automaticEnabled=body.enabled;await store.put('memories',m);return m;
        });
        return json(200,memoryView(saved,id));
      }
      const memorySource=path.match(/^\/api\/characters\/([a-f0-9-]{36})\/memories\/([a-f0-9-]{36}|[a-f0-9]{64})\/sources$/);
      if(memorySource&&req.method==='GET'){
        const [,roleId,recordId]=memorySource;if(!await activeRole(roleId))return json(404,{error:'角色不存在'});
        const memory=await store.get('memories',roleId),root=memory?.records.find(r=>r.id===recordId&&!r.deletedAt);if(!root)return json(404,{error:'记忆不存在'});
        const pending=[root],visited=new Set(),seen=new Set(),sources=[];
        while(pending.length&&visited.size<200&&sources.length<20){
          const record=pending.pop();if(visited.has(record.id))continue;visited.add(record.id);
          for(const ref of record.mergedFrom||[]){const old=memory.records.find(r=>r.id===ref.id);if(old)pending.push(old);}
          if(!record.sourceChatId||!record.sourceMessageId)continue;
          const key=record.sourceChatId+':'+record.sourceMessageId;if(seen.has(key))continue;seen.add(key);
          const sourceChat=await store.get('chats',record.sourceChatId);
          if(!sourceChat||sourceChat.characterId!==roleId){sources.push({unavailable:true});continue;}
          const message=sourceChat.messages.find(m=>m.id===record.sourceMessageId);
          if(!message){sources.push({unavailable:true});continue;}
          sources.push({chatId:sourceChat.id,messageId:message.id,title:sourceChat.title,content:message.content,role:message.role,createdAt:message.createdAt,inTrash:!!sourceChat.deletedAt});
        }
        return json(200,{sources,truncated:pending.length>0});
      }
      const memoryReview=path.match(/^\/api\/characters\/([a-f0-9-]{36})\/memories\/(review|merge)$/);
      if(memoryReview){
        const id=memoryReview[1];if(!await activeRole(id))return json(404,{error:'角色不存在'});
        if(req.method==='GET'&&memoryReview[2]==='review')return json(200,reviewMemories(await store.get('memories',id)));
        if(req.method==='POST'&&memoryReview[2]==='merge'){
          const saved=await withMemoryLock(id,async()=>{const old=await store.get('memories',id)||{id,records:[]};const next=mergeReviewedMemories(old,body);await store.put('memories',next);return next;});
          return json(200,memoryView(saved,id));
        }
      }
      const memoryImport=path.match(/^\/api\/characters\/([a-f0-9-]{36})\/memories\/import$/);
      if(memoryImport&&req.method==='POST'){
        const id=memoryImport[1];if(!await activeRole(id))return json(404,{error:'角色不存在'});
        if(memoryWrites.has(id))return json(409,{error:'记忆正在保存，请稍后重试'});
        memoryWrites.add(id);
        try{
          const old=await store.get('memories',id)||{id,characterId:id,records:[]};
          const result=mergeMemoryBackup(old,body.backup);
          if(body.preview===true)return json(200,result.summary);
          if(body.preview!==false)throw new Error('请明确选择预览或恢复记忆');
          if(result.summary.added||result.memory.importKeys.length!==(old.importKeys||[]).length)await store.put('memories',result.memory);
          return json(200,{summary:result.summary,memory:{...result.memory,records:result.memory.records.filter(r=>!r.deletedAt)}});
        }finally{memoryWrites.delete(id);}
      }
      const memoryExport=path.match(/^\/api\/characters\/([a-f0-9-]{36})\/memories\/export$/);
      if(memoryExport&&req.method==='GET'){
        const role=await activeRole(memoryExport[1]);if(!role)return json(404,{error:'角色不存在'});
        const format=url.searchParams.get('format')||'json';
        const content=exportMemory(await store.get('memories',role.id),role,format);
        res.writeHead(200,{'Content-Type':format==='json'?'application/json; charset=utf-8':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="muse-memory-${role.id}.${format}"`,'Cache-Control':'no-store'});
        return res.end(content);
      }
      const memoryMatch=path.match(/^\/api\/characters\/([a-f0-9-]{36})\/memories(?:\/([a-f0-9-]{36}|[a-f0-9]{64}))?$/);
      if(memoryMatch){
        const id=memoryMatch[1],recordId=memoryMatch[2];
        if(!await activeRole(id))return json(404,{error:'角色不存在'});
        const visible=m=>memoryView(m,id);
        if(req.method==='GET'&&!recordId)return json(200,visible(await store.get('memories',id)||{records:[]}));
        if((req.method==='POST'&&!recordId)||(['PUT','DELETE'].includes(req.method)&&recordId)){
          if(memoryWrites.has(id))return json(409,{error:'记忆正在保存，请稍后重试'});
          memoryWrites.add(id);
          try{
            const old=await store.get('memories',id)||{id,characterId:id,records:[]};
            const changed=changeMemory(old,req.method,recordId,body);
            if(req.method==='POST'&&(body.sourceChatId!==undefined||body.sourceMessageId!==undefined)){
              if(typeof body.sourceChatId!=='string'||typeof body.sourceMessageId!=='string')throw new Error('来源消息无效');
              const source=await store.get('chats',body.sourceChatId);
              if(!source||source.deletedAt||source.characterId!==id||!source.messages.some(m=>m.id===body.sourceMessageId))throw new Error('来源消息不存在或不属于该角色');
              Object.assign(changed.records.at(-1),{sourceChatId:source.id,sourceMessageId:body.sourceMessageId});
            }
            await store.put('memories',changed);
            return json(200,visible(changed));
          }finally{memoryWrites.delete(id);}
        }
        return json(405,{error:'不支持的方法'});
      }
      const roleLifecycle=path.match(/^\/api\/characters\/([a-f0-9-]{36})(\/restore|\/purge)?$/);
      if(roleLifecycle&&((req.method==='DELETE'&&!roleLifecycle[2])||roleLifecycle[2])){
        const id=roleLifecycle[1],action=roleLifecycle[2]||'/trash';
        if(req.method!==(action==='/restore'?'POST':'DELETE'))return json(405,{error:'不支持的方法'});
        if(roleChanges.has(id)||activeApi>1||automaticJobs.has(id)||memoryWrites.has(id))return json(409,{error:'正在处理数据，请稍后再操作角色回收站'});
        roleChanges.add(id);
        try{
          const role=await store.get('characters',id);if(!role)return json(404,{error:'角色不存在'});
          if((action==='/trash'?!!role.deletedAt:!role.deletedAt)||(body.updatedAt!==undefined&&body.updatedAt!==role.updatedAt))return json(409,{error:'角色状态已变化，请刷新后操作'});
          if(action!=='/trash'&&body.updatedAt!==role.updatedAt)return json(409,{error:'角色状态已变化，请刷新后操作'});
          if((await store.list('chats')).some(c=>c.characterId===id&&busy.has(c.id)))return json(409,{error:'此角色正在生成回复，请结束后再操作'});
          if(action==='/purge'){
            const memory=await store.get('memories',id);
            if(memory)await store.remove('memories',id);
            try{await store.remove('characters',id);}catch(error){if(memory)await store.put('memories',memory);throw error;}
            automaticState.delete(id);
          }else{
            if(action==='/restore')delete role.deletedAt;else role.deletedAt=Date.now();
            role.updatedAt=Math.max(Date.now(),role.updatedAt+1);await store.put('characters',role);
          }
          return json(200,{ok:true});
        }finally{roleChanges.delete(id);}
      }
      const roleMatch = path.match(/^\/api\/characters\/([a-f0-9-]{36})$/);
      if(roleMatch) {
        const role = await activeRole(roleMatch[1]); if(!role) return json(404,{error:'角色不存在'});
        if(req.method === 'PUT') return json(200,await store.put('characters',character(body,role)));
      }
      if(path==='/api/chats/import'&&req.method==='POST'){
        const role=await activeRole(body.characterId);if(!role)return json(404,{error:'请先选择一个现有角色'});
        const restored=importChat(body.chat,role),key=role.id+restored.importFingerprint;
        if(chatImports.has(key))return json(409,{error:'这份备份正在导入，请稍后重试'});
        chatImports.add(key);
        try{
          const existing=(await store.list('chats')).find(c=>!c.deletedAt&&c.characterId===role.id&&c.importFingerprint===restored.importFingerprint);
          if(existing)return json(200,{chat:existing,duplicate:true});
          await store.put('chats',restored);return json(201,{chat:restored,duplicate:false});
        }finally{chatImports.delete(key);}
      }
      if(path==='/api/favorites'&&req.method==='GET'){
        const q=(url.searchParams.get('q')||'').trim().toLocaleLowerCase();if(q.length>200)throw Error('搜索关键词最多 200 字');
        const rows=[];
        for(const c of await store.list('chats'))if(!c.deletedAt)for(const m of c.messages)if(m.favoriteAt&&(!q||`${c.title} ${c.characterName} ${m.content}`.toLocaleLowerCase().includes(q)))rows.push({chatId:c.id,messageId:m.id,characterName:c.characterName,title:c.title,role:m.role,content:m.content.slice(0,2000),favoriteAt:m.favoriteAt,updatedAt:c.updatedAt});
        rows.sort((a,b)=>b.favoriteAt-a.favoriteAt);
        const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)throw Error('分页位置无效');
        return json(200,{total:rows.length,items:rows.slice(offset,offset+50)});
      }
      if(path === '/api/chats') {
        if(req.method === 'GET') {
          const q=url.searchParams.get('q')||'';if(q.length>200)throw new Error('搜索关键词最多 200 字');
          return json(200,(await store.list('chats')).filter(c=>!!c.deletedAt===(url.searchParams.get('trash')==='1')).map(c=>chatSummary(c,q)).filter(Boolean));
        }
        if(req.method === 'POST') {
          const role = await activeRole(body.characterId); if(!role) return json(404,{error:'角色不存在'});
          const chat = {schemaVersion:1,id:randomUUID(),characterId:role.id,characterName:role.name,title:`与 ${role.name} 的对话`,createdAt:Date.now(),updatedAt:Date.now(),messages:[]};
          if(role.greeting) chat.messages.push({id:randomUUID(),role:'assistant',content:substitute(role.greeting,role),createdAt:Date.now()});
          return json(201,await store.put('chats',chat));
        }
      }
      const match = path.match(/^\/api\/chats\/([a-f0-9-]{36})(\/messages|\/stop|\/export|\/revision|\/organization|\/summary|\/version|\/restore|\/purge|\/favorite)?$/);
      if(match) {
        const id=match[1], chat=await store.get('chats',id); if(!chat) return json(404,{error:'会话不存在'});
        if(match[2]==='/restore'||match[2]==='/purge'){
          if((match[2]==='/restore'&&req.method!=='POST')||(match[2]==='/purge'&&req.method!=='DELETE'))return json(405,{error:'不支持的方法'});
          if(!chat.deletedAt||body.updatedAt!==chat.updatedAt||busy.has(id))return json(409,{error:'回收站记录已变化，请刷新后操作'});
          busy.set(id,new AbortController());try{
            if(match[2]==='/purge')await store.remove('chats',id);
            else{delete chat.deletedAt;chat.updatedAt=Math.max(Date.now(),chat.updatedAt+1);await store.put('chats',chat);}
            return json(200,{ok:true});
          }finally{busy.delete(id);}
        }
        if(chat.deletedAt)return json(409,{error:'聊天已移入回收站，请先在设置中恢复'});
        if(req.method === 'GET' && !match[2]) return json(200,{...chat,generating:busy.has(id)});
        if(req.method==='GET'&&match[2]==='/export'){
          if(busy.has(id))return json(409,{error:'请等待生成结束再导出聊天'});
          const format=url.searchParams.get('format')||'json',content=exportChat(chat,format);
          res.writeHead(200,{'Content-Type':format==='json'?'application/json; charset=utf-8':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="muse-chat-${id}.${format}"`,'Cache-Control':'no-store'});return res.end(content);
        }
        if(req.method === 'POST' && match[2]==='/stop') {
          busy.get(id)?.abort(); return json(200,{ok:true});
        }
        if(busy.has(id)) return json(409,{error:'该会话正在生成回复'});
        if(req.method==='PUT'&&match[2]==='/favorite'){
          if(body.updatedAt!==chat.updatedAt)return json(409,{error:'聊天已变化，请刷新后操作'});
          if(typeof body.enabled!=='boolean')throw Error('收藏状态无效');
          const message=chat.messages.find(m=>m.id===body.messageId);if(!message)return json(404,{error:'消息不存在'});
          busy.set(id,new AbortController());try{
            if(body.enabled)message.favoriteAt=message.favoriteAt||Date.now();else delete message.favoriteAt;
            chat.updatedAt=Math.max(Date.now(),chat.updatedAt+1);return json(200,await store.put('chats',chat));
          }finally{busy.delete(id);}
        }
        if(req.method==='PUT'&&match[2]==='/version'){
          if(body.updatedAt!==chat.updatedAt)return json(409,{error:'聊天已变化，请重新打开后操作'});
          busy.set(id,new AbortController());try{return json(200,await store.put('chats',selectReplyVersion(chat,body.messageId,body.index)));}finally{busy.delete(id);}
        }
        if(match[2]==='/summary'&&['POST','PUT'].includes(req.method)){
          if(body.updatedAt!==chat.updatedAt)return json(409,{error:'聊天已变化，请重新打开摘要后操作'});
          const controller=new AbortController();busy.set(id,controller);
          try{
            if(req.method==='POST'){
              if(!apiKey)throw new Error('请先配置 DeepSeek API Key');
              const base={...chat,summary:undefined};chat.summary=await generateSummary(base,apiKey,provider,controller.signal);
              delete chat.summaryError;
            }else{
              if('enabled' in body){if(typeof body.enabled!=='boolean')throw new Error('摘要开关无效');chat.summaryEnabled=body.enabled;}
              if('text' in body){if(!validSummary(chat))throw new Error('尚无有效摘要，请先生成');if(typeof body.text!=='string'||!body.text.trim()||body.text.length>8000)throw new Error('摘要须为 1–8000 字');chat.summary={...chat.summary,text:body.text.trim(),edited:true,updatedAt:Date.now()};}
            }
            chat.updatedAt=Math.max(Date.now(),chat.updatedAt+1);await store.put('chats',chat);return json(200,chat);
          }finally{busy.delete(id);}
        }
        if(req.method==='PUT'&&match[2]==='/organization'){
          if(body.updatedAt!==chat.updatedAt)return json(409,{error:'聊天已变化，请重新打开后操作'});
          if(!['pinned','archived'].some(k=>k in body)||['pinned','archived'].some(k=>k in body&&typeof body[k]!=='boolean'))throw new Error('无效聊天整理设置');
          busy.set(id,new AbortController());
          try{for(const key of ['pinned','archived'])if(key in body)chat[key]=body[key];chat.updatedAt=Math.max(Date.now(),chat.updatedAt+1);await store.put('chats',chat);return json(200,chat);}finally{busy.delete(id);}
        }
        if(req.method==='POST'&&match[2]==='/revision'){
          if(body.updatedAt!==chat.updatedAt)return json(409,{error:'聊天已变化，请重新打开后操作'});
          const index=chat.messages.findIndex(m=>m.id===body.messageId);
          if(index<0)throw new Error('消息不存在');
          const regenerate=body.action==='regenerate';
          if(!regenerate&&body.action!=='edit')throw new Error('无效操作');
          if(regenerate&&(chat.messages[index].role!=='assistant'||chat.messages[index-1]?.role!=='user'))throw new Error('只能重新生成用户消息之后的回答');
          if(!regenerate&&(typeof body.content!=='string'||!body.content.trim()||body.content.length>30000))throw new Error('消息须为 1–30000 字');
          const messages=structuredClone(chat.messages.slice(0,regenerate?index:index+1));
          for(const message of messages)delete message.favoriteAt;
          if(!regenerate){messages.at(-1).content=body.content.trim();delete messages.at(-1).finishReason;delete messages.at(-1).memoryTrace;delete messages.at(-1).versions;delete messages.at(-1).activeVersion;}
          const now=Date.now(),branch={schemaVersion:1,id:randomUUID(),characterId:chat.characterId,characterName:chat.characterName,title:`${chat.title.slice(0,85)} · ${regenerate?'重新生成':'编辑分支'}`,createdAt:now,updatedAt:now,messages,parentChatId:chat.id,parentMessageId:body.messageId,branchAction:body.action};
          return json(201,await store.put('chats',branch));
        }
        if(req.method==='PUT'&&!match[2]){
          if(typeof body.title!=='string'||!body.title.trim()||body.title.length>100)throw new Error('聊天名称须为 1–100 字');
          if(body.updatedAt!==chat.updatedAt)return json(409,{error:'聊天已变化，请重新打开后改名'});
          busy.set(id,new AbortController());
          try{chat.title=body.title.trim();chat.updatedAt=Date.now();await store.put('chats',chat);return json(200,chat);}finally{busy.delete(id);}
        }
        if(req.method === 'DELETE' && !match[2]) {
          if(body.updatedAt!==undefined&&body.updatedAt!==chat.updatedAt)return json(409,{error:'聊天已变化，请重新打开后操作'});
          busy.set(id,new AbortController());try{chat.deletedAt=Date.now();chat.updatedAt=Math.max(chat.deletedAt,chat.updatedAt+1);await store.put('chats',chat);return json(200,{ok:true});}finally{busy.delete(id);}
        }
        if(req.method === 'POST' && match[2]==='/messages') {
          const role=await activeRole(chat.characterId); if(!role) return json(409,{error:'角色已删除，历史聊天仍可查看'});
          if(!apiKey) return json(400,{error:'请先配置 DeepSeek API Key'});
          const retry=body.retry === true;
          const regenerating=body.regenerate===true,original=regenerating?chat.messages.at(-1):null;
          if(regenerating&&(body.updatedAt!==chat.updatedAt||original?.id!==body.messageId||original?.role!=='assistant'||chat.messages.at(-2)?.role!=='user'))throw new Error('只能重新生成当前最后一条回复，请重新打开聊天');
          if(regenerating&&(original.versions?.length||1)>=50)throw new Error('本条回复已达到 50 个版本上限，请使用分支');
          if(!retry&&!regenerating && (typeof body.content !== 'string' || !body.content.trim() || body.content.length>30000)) throw new Error('消息须为 1–30000 字');
          if(retry && chat.messages.at(-1)?.role !== 'user') throw new Error('没有待重试的消息');
          if(!retry && chat.messages.at(-1)?.role === 'user') throw new Error('请先重试上一条消息');
          if(busy.has(id)) return json(409,{error:'该会话正在生成回复'});
          const controller=new AbortController(); busy.set(id,controller);
          const streaming=body.stream===true;
          let partial='', heartbeat,memoryTrace;
          const event=value=>{if(!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value)+'\n');};
          const disconnect=()=>{if(!res.writableEnded)controller.abort();};
          res.on('close',disconnect);
          try {
            if(!retry&&!regenerating) chat.messages.push({id:randomUUID(),role:'user',content:body.content.trim(),createdAt:Date.now()});
            chat.updatedAt=Date.now(); delete chat.error; await store.put('chats',chat);
            if(streaming) {
              res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
              event({type:'start',chat});
              heartbeat=setInterval(()=>event({type:'ping'}),15000);
            }
            const memory=await store.get('memories',role.id);
            const contextChat=regenerating?{...chat,messages:chat.messages.slice(0,-1)}:chat;
            let history;
            try{if(needsSummary(contextChat)){contextChat.summary=await generateSummary(contextChat,apiKey,provider,controller.signal);delete chat.summaryError;}chat.summary=contextChat.summary;history=summaryHistory(contextChat);}
            catch(e){if(controller.signal.aborted)throw e;chat.summaryError='摘要生成失败，本轮使用完整聊天原文。';history=contextChat.messages;}
            const snapshot=memoryContextSnapshot(memory,24000,Date.now(),contextChat.messages.findLast(m=>m.role==='user')?.content||'');memoryTrace=snapshot.trace;
            const toolSchemas=await dsh.tools(role.id),onDelta=streaming?delta=>{partial+=delta;event({type:'delta',content:delta});}:undefined;
            const userMessageId=contextChat.messages.findLast(m=>m.role==='user')?.id;
            if(toolSchemas.length&&(chat.toolRuns||[]).some(r=>r.userMessageId===userMessageId))throw Error('这条消息已有工具执行记录。为避免重复操作，请先在 DSH 核对结果，再发送新的消息。');
            const answer=toolSchemas.length?await completeWithTools({...role,memoryContext:snapshot.prompt},history,apiKey,{tools:toolSchemas,signal:controller.signal,onDelta,
              invoke:async(callId,tool,args)=>{if(!await activeRole(role.id))throw Error('角色不可用');return dsh.invoke(role.id,chat.id,callId,tool,args,controller.signal);},
              record:async entry=>{chat.toolRuns??=[];const row={...entry,userMessageId,roleId:role.id,chatId:chat.id},i=chat.toolRuns.findIndex(r=>r.id===entry.id);if(i<0)chat.toolRuns.push(row);else chat.toolRuns[i]=row;await store.put('chats',chat);if(streaming)event({type:'tool',tool:entry.tool,status:entry.status});}
            }):await provider({...role,memoryContext:snapshot.prompt},history,apiKey,{signal:controller.signal,onDelta});
            controller.signal.throwIfAborted();
            const reply={id:randomUUID(),role:'assistant',...answer,createdAt:Date.now(),memoryTrace};
            if(regenerating)chat.messages[chat.messages.length-1]=addReplyVersion(original,reply);else chat.messages.push(reply);
            chat.updatedAt=Date.now(); await store.put('chats',chat);
            if(answer.finishReason==='stop')remember(role.id,chat.id,structuredClone(chat.messages),apiKey);
            if(streaming){event({type:'done',chat});return res.end();}
            return json(200,chat);
          } catch(e) {
            const stopped=controller.signal.aborted;
            chat.error=stopped?'已停止生成':e.name === 'TimeoutError'?'请求超时，请重试':e.message;
            if(partial){const reply={id:randomUUID(),role:'assistant',content:partial,finishReason:stopped?'cancelled':'error',createdAt:Date.now(),memoryTrace};if(regenerating)chat.messages[chat.messages.length-1]=addReplyVersion(original,reply);else chat.messages.push(reply);}
            chat.updatedAt=Date.now(); await store.put('chats',chat);
            if(streaming && res.headersSent){event({type:'error',error:chat.error,chat});return res.end();}
            return json(502,{error:chat.error});
          }
          finally { clearInterval(heartbeat);res.off('close',disconnect);busy.delete(id); }
        }
      }
      return json(404,{error:'未找到接口'});
    } catch(e) { json(400,{error:e.code ? '本地数据操作失败，请检查目录权限或文件完整性' : e.message}); }
    finally{if(tracked)activeApi--;}
  });
  return server;
}
if(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server=await createApp(); server.listen(Number(process.env.PORT || 3210),'127.0.0.1',() => console.log(`Muse v0.1.0 http://127.0.0.1:${server.address().port}`));
}
