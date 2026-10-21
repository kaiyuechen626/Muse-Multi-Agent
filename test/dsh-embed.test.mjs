// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
test('仅专用入口允许 DSH 原生页面嵌入，API 同源限制保留',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-embed-'));const server=await createApp({dataDir:dir});
 try{server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/','/?embed=other'])assert.match((await fetch(base+path)).headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match((await fetch(base+'/?embed=dsh')).headers.get('content-security-policy'),/frame-ancestors dsh-app:\/\/app$/);
  assert.equal((await fetch(base+'/api/characters',{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(base+'/api/health')).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
