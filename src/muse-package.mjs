// SPDX-License-Identifier: GPL-3.0-or-later
import { inflateRawSync } from 'node:zlib';
import { crc32 } from '../web/png-card.js';
import { importCard } from './characters.mjs';

// Read only the known entries in memory. Never extract archive paths to disk.
export function readMuseZip(bytes){
  const b=Buffer.from(bytes);
  if(b.length>20000000)throw new Error('手机角色包不能超过 20 MB');
  let end=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
  if(end<0)throw new Error('角色包不是完整 ZIP，请重新从手机导出');
  const count=b.readUInt16LE(end+10),size=b.readUInt32LE(end+12),start=b.readUInt32LE(end+16);
  if(b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||b.readUInt16LE(end+8)!==count||count>64||start+size!==end)throw new Error('不支持此角色包结构（分卷／ZIP64／条目过多）');
  let offset=start,total=0;const entries=new Map();
  for(let i=0;i<count;i++){
    if(offset+46>end||b.readUInt32LE(offset)!==0x02014b50)throw new Error('角色包目录损坏');
    const flags=b.readUInt16LE(offset+8),method=b.readUInt16LE(offset+10),crc=b.readUInt32LE(offset+16),packed=b.readUInt32LE(offset+20),unpacked=b.readUInt32LE(offset+24),nameLength=b.readUInt16LE(offset+28),extra=b.readUInt16LE(offset+30),comment=b.readUInt16LE(offset+32),local=b.readUInt32LE(offset+42);
    const next=offset+46+nameLength+extra+comment;
    if(next>end)throw new Error('角色包目录长度无效');
    const name=b.subarray(offset+46,offset+46+nameLength).toString('utf8');offset=next;
    if(name.includes('..')||name.includes('\\')||name.startsWith('/')||name.includes(':'))throw new Error('角色包包含不安全路径');
    if(flags&1)throw new Error('不支持加密角色包，请使用手机的角色导出功能');
    if(name!=='assistant.json'&&!/^avatar\.(png|jpg|jpeg|webp)$/i.test(name))continue;
    if(entries.has(name)||(/^avatar\./i.test(name)&&[...entries.keys()].some(k=>/^avatar\./i.test(k))))throw new Error('角色包包含重复的角色或头像文件');
    total+=unpacked;
    if(unpacked>10000000||total>12000000||packed>20000000)throw new Error('角色包解压内容过大');
    if(local+30>start||b.readUInt32LE(local)!==0x04034b50)throw new Error('角色包文件头无效');
    const localName=b.readUInt16LE(local+26),dataStart=local+30+localName+b.readUInt16LE(local+28);
    if(dataStart+packed>start||b.subarray(local+30,local+30+localName).toString('utf8')!==name||b.readUInt16LE(local+8)!==method||b.readUInt16LE(local+6)!==flags)throw new Error('角色包文件信息不一致');
    if(![0,8].includes(method))throw new Error('角色包使用了不支持的压缩方式');
    let data;try{data=method===0?b.subarray(dataStart,dataStart+packed):inflateRawSync(b.subarray(dataStart,dataStart+packed),{maxOutputLength:10000000});}catch{throw new Error('角色包解压失败或内容过大');}
    if(data.length!==unpacked||crc32(data)!==crc)throw new Error('角色包校验失败，请重新传输文件');
    entries.set(name,data);
  }
  if(offset!==end)throw new Error('角色包目录不完整');
  if(!entries.has('assistant.json'))throw new Error('未找到 assistant.json。请在手机 Muse 中导出单个角色，而不是完整备份');
  return entries;
}
export function importMusePackage(bytes){
  const entries=readMuseZip(bytes);let source;
  try{source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entries.get('assistant.json')).replace(/^\uFEFF/,''));}catch{throw new Error('手机角色包中的 assistant.json 无效');}
  if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('手机角色包中的角色内容无效');
  const avatarEntry=[...entries].find(([name])=>/^avatar\./i.test(name));
  if(avatarEntry)source={...source,avatarImageUrl:''};
  const parsed=importCard(source);
  // Only our DeepSeek provider is available; Android model IDs may be database IDs.
  if(!/^deepseek-[a-z0-9-]+$/i.test(parsed.character.model)){
    parsed.warnings.push(`手机模型“${parsed.character.model}”未连接，已改用 deepseek-chat；可在预览中修改。`);
    parsed.character.model='deepseek-chat';
  }
  if(avatarEntry){
    const [name,data]=avatarEntry;const ext=name.split('.').at(-1).toLowerCase();
    const valid=ext==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='webp'?data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP':data[0]===255&&data[1]===216;
    if(!valid)throw new Error('角色包头像内容与图片格式不符');
    parsed.avatarData=`data:image/${['jpg','jpeg'].includes(ext)?'jpeg':ext};base64,${data.toString('base64')}`;
  }
  parsed.warnings.push('已导入角色基本设定。手机的工具、知识库和记忆配置暂不执行；API Key 不会从角色包导入。');
  return parsed;
}
