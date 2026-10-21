// SPDX-License-Identifier: GPL-3.0-or-later
// SillyTavern stores UTF-8 JSON as base64 in a PNG tEXt chunk named "chara".
const signature=[137,80,78,71,13,10,26,10];
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function parsePngCard(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length>7000000)throw new Error('PNG 角色卡不能超过 7 MB');
  if(bytes.length<33||!signature.every((v,i)=>bytes[i]===v))throw new Error('文件不是有效的 PNG 图片');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), ascii=new TextDecoder('latin1');
  let offset=8,ended=false,hasImage=false,encoded=null,v3=false,width=0,height=0;
  while(offset<bytes.length){
    if(offset+12>bytes.length)throw new Error('PNG 文件不完整');
    const length=view.getUint32(offset),end=offset+12+length;
    if(end>bytes.length)throw new Error('PNG 数据块长度无效');
    const type=ascii.decode(bytes.subarray(offset+4,offset+8)),data=bytes.subarray(offset+8,end-4);
    if(crc32(bytes.subarray(offset+4,end-4))!==view.getUint32(end-4))throw new Error('PNG 校验失败，文件可能已损坏');
    if(offset===8){
      if(type!=='IHDR'||length!==13)throw new Error('PNG 缺少有效图片头');
      width=view.getUint32(offset+8);height=view.getUint32(offset+12);
      if(!width||!height||width>8192||height>8192||width*height>16000000)throw new Error('PNG 图片尺寸过大（最多 1600 万像素，单边 8192）');
    }else if(type==='IHDR')throw new Error('PNG 包含重复图片头');
    if(type==='IDAT')hasImage=true;
    if(type==='tEXt'){
      const split=data.indexOf(0);
      if(split>0&&split<=79){
        const key=ascii.decode(data.subarray(0,split)).toLowerCase();
        if(key==='ccv3')v3=true;
        if(key==='chara'){
          if(encoded!==null)throw new Error('PNG 包含多份 chara 数据，请重新导出角色卡');
          if(data.length-split>1400000)throw new Error('PNG 角色设定过大（最多约 1 MB）');
          encoded=ascii.decode(data.subarray(split+1));
        }
      }
    }
    offset=end;
    if(type==='IEND'){if(length!==0||offset!==bytes.length)throw new Error('PNG 结束块无效');ended=true;break;}
  }
  if(!ended||!hasImage)throw new Error('PNG 文件不完整');
  if(encoded===null)throw new Error(v3?'此 PNG 仅包含 V3 角色卡，请导出为 SillyTavern V2 后导入':'这是一张普通 PNG，未找到 chara 角色设定；可在角色编辑中用作头像');
  if(!encoded.length||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('PNG 角色数据不是有效的 Base64');
  let card;
  try{const decoded=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));card=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));}
  catch{throw new Error('PNG 内嵌角色 JSON 无效');}
  return {card,warnings:v3?['检测到 V3 数据，本版读取兼容的 V2 chara 数据。']:[]};
}

export async function pngAvatar(file){
  const bitmap=await createImageBitmap(file).catch(()=>{throw new Error('角色头像无法解码，请重新导出角色卡');});
  try{
    if(bitmap.width*bitmap.height>16000000)throw new Error('角色头像过大，最多支持 1600 万像素');
    const ratio=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const context=canvas.getContext('2d');context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    // Re-encode pixels: do not duplicate embedded card metadata into the avatar.
    return canvas.toDataURL('image/png');
  }finally{bitmap.close();}
}
