// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readMuseZip,importMusePackage } from '../src/muse-package.mjs';
import { crc32 } from '../web/png-card.js';
import { pngFixture } from './png-fixture.mjs';
export function zipFixture(entries,descriptor=true){
 const locals=[],central=[];let offset=0;
 for(const [name,content]of entries){
  const data=Buffer.from(content),packed=deflateRawSync(data),n=Buffer.from(name),crc=crc32(data),flags=descriptor?8:0;
  const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(flags,6);l.writeUInt16LE(8,8);l.writeUInt16LE(n.length,26);
  if(!descriptor){l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(data.length,22);}
  const dd=Buffer.alloc(descriptor?16:0);if(descriptor){dd.writeUInt32LE(0x08074b50);dd.writeUInt32LE(crc,4);dd.writeUInt32LE(packed.length,8);dd.writeUInt32LE(data.length,12);}
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(flags,8);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  locals.push(l,n,packed,dd);central.push(c,n);offset+=l.length+n.length+packed.length+dd.length;
 }
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,cd,end]);
}
export const phoneCard={id:'',name:'手机导出测试',systemPrompt:'你是温和的旅行伙伴。',modelId:'android-model-uuid',presetMessagesJson:'[{"role":"USER","content":"你好"},{"role":"ASSISTANT","content":"很高兴见到你"}]',avatarImageUrl:'/data/user/0/io.zer0.muse/avatar.png',customHeadersJson:'{"Authorization":"secret-test"}'};
test('手机 Muse ZIP：Java data descriptor、UTF-8 JSON、包内头像和模型回退',()=>{
 for(const descriptor of [true,false]){
  const parsed=importMusePackage(zipFixture([['assistant.json',JSON.stringify(phoneCard)],['avatar.png',pngFixture()]],descriptor));
  assert.equal(parsed.character.name,'手机导出测试');assert.equal(parsed.character.persona,phoneCard.systemPrompt);assert.equal(parsed.character.model,'deepseek-chat');assert.match(parsed.character.examples,/\{\{char\}\}: 很高兴见到你/);assert.match(parsed.avatarData,/^data:image\/png;base64,/);assert.ok(!JSON.stringify(parsed).includes('secret-test'));
 }
});
test('手机 Muse ZIP：缺少角色、重复条目、路径穿越、损坏及解压上限',()=>{
 assert.throws(()=>readMuseZip(Buffer.from('not zip')),/完整 ZIP/);
 assert.throws(()=>readMuseZip(zipFixture([['readme.txt','nothing']])),/assistant.json/);
 assert.throws(()=>readMuseZip(zipFixture([['../assistant.json','{}']])),/不安全/);
 assert.throws(()=>readMuseZip(zipFixture([['assistant.json','{}'],['assistant.json','{}']])),/重复/);
 assert.throws(()=>importMusePackage(zipFixture([['assistant.json','bad json']])),/无效/);
 assert.throws(()=>readMuseZip(zipFixture([['assistant.json',Buffer.alloc(10000001)]])),/过大/);
 const broken=zipFixture([['assistant.json','{}']]);broken[45]^=255;assert.throws(()=>readMuseZip(broken),/校验|解压/);
});
