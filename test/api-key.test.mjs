// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {complete} from '../src/provider.mjs';
import {completeWithTools} from '../src/tool-completion.mjs';
import {createApp} from '../src/server.mjs';

test('invalid header credentials fail before chat or tool requests, without echoing credentials',async()=>{
  for(const key of ['测试密钥','fake key','fake\nkey','fake\u007fkey','x'.repeat(513)]) {
    const options={fetchImpl:async()=>assert.fail('invalid credential reached network')};
    for(const run of [()=>complete({},[],key,options),()=>completeWithTools({},[],key,options)]) {
      await assert.rejects(run(),e=>/API Key 格式无效/.test(e.message)&&!e.message.includes(key));
    }
  }
});

test('rejecting invalid settings preserves the current credential and can recover with a valid value',async()=>{
  const root=await mkdtemp(join(tmpdir(),'muse-key-validation-'));
  const previous=process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY='无效旧配置';
  let calls=0;
  const server=await createApp({dataDir:root,provider:async(_role,_history,key)=>{
    assert.equal(key,'test-key');calls++;return {content:'OK',finishReason:'stop'};
  }});
  if(previous===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previous;
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const req=(path,method='GET',body)=>fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{
    method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined
  });
  try {
    const settings=await (await req('settings')).json();
    assert.equal(settings.configured,false);assert.match(settings.warning,/API Key 格式无效/);
    const failed=await req('settings/test','POST',{});assert.equal(failed.status,400);
    assert.match((await failed.json()).error,/API Key 格式无效/);assert.equal(calls,0);
    assert.equal((await req('settings','PUT',{apiKey:'test-key'})).status,200);
    for(const apiKey of ['中文占位符','bad key','bad\tkey']) {
      const response=await req('settings','PUT',{apiKey,remember:true});assert.equal(response.status,400);
      assert.match((await response.json()).error,/API Key 格式无效/);
    }
    assert.equal((await req('settings/test','POST',{})).status,200);assert.equal(calls,1);
  } finally {await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
