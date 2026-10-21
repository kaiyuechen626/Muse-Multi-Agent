// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { parsePngCard } from '../web/png-card.js';
import { createApp } from '../src/server.mjs';
import { cardFixture,chunk,pngFixture } from './png-fixture.mjs';
test('PNG: 中文 V2 设定、扩展、混合 V3 的兼容数据',()=>{
 assert.deepEqual(parsePngCard(pngFixture()).card,cardFixture);
 assert.equal(parsePngCard(pngFixture({extra:[chunk('tEXt',Buffer.from('ccv3\0e30='))]})).warnings.length,1);
 const bytes=pngFixture(),padded=Buffer.concat([Buffer.alloc(5),bytes]);assert.deepEqual(parsePngCard(padded.subarray(5)).card,cardFixture);
});
test('PNG: 普通图片、V3-only、重复角色块、无效编码和超大图片',()=>{
 assert.throws(()=>parsePngCard(pngFixture({text:null})),/普通 PNG/);
 assert.throws(()=>parsePngCard(pngFixture({text:null,extra:[chunk('tEXt',Buffer.from('ccv3\0e30='))]})),/仅包含 V3/);
 assert.throws(()=>parsePngCard(pngFixture({extra:[chunk('tEXt',Buffer.from('chara\0e30='))]})),/多份/);
 assert.throws(()=>parsePngCard(pngFixture({text:'!'})),/Base64/);
 assert.throws(()=>parsePngCard(pngFixture({text:Buffer.from('not json').toString('base64')})),/JSON 无效/);
 assert.throws(()=>parsePngCard(pngFixture({width:9000})),/尺寸过大/);
 assert.throws(()=>parsePngCard(new Uint8Array(7000001)),/7 MB/);
 assert.throws(()=>parsePngCard(pngFixture({text:'A'.repeat(1400000)})),/设定过大/);
});
test('PNG: 损坏校验、截断、伪造长度和伪装扩展名',()=>{
 const bad=pngFixture();bad[50]^=1;assert.throws(()=>parsePngCard(bad),/校验失败/);
 assert.throws(()=>parsePngCard(pngFixture().subarray(0,-5)),/不完整/);
 const huge=pngFixture();huge.writeUInt32BE(0xffffffff,33);assert.throws(()=>parsePngCard(huge),/长度无效/);
 assert.throws(()=>parsePngCard(Buffer.from('not png')),/有效的 PNG/);
});
test('PNG 提取后沿用预览保存：预览无落盘，编辑保存保留扩展，重复导入不覆盖',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-png-')),server=await createApp({dataDir:root});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}/api/`;
 const api=async(path,body)=>{const r=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});assert.ok(r.ok);return r.json();};
 try{
  const card=parsePngCard(pngFixture()).card,preview=await api('import',card);
  assert.equal((await api('characters')).length,0);
  const first=await api('characters',{...preview.character,name:'预览时改名',importCard:card});
  const second=await api('characters',{...preview.character,importCard:card});
  assert.notEqual(first.id,second.id);assert.equal(first.name,'预览时改名');assert.equal(first.cardMetadata.data.extensions.test.preserved,true);
  assert.equal((await api('characters')).length,2);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
