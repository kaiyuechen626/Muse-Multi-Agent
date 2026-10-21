// SPDX-License-Identifier: GPL-3.0-or-later
import { deflateSync } from 'node:zlib';
import { crc32 } from '../web/png-card.js';
export const cardFixture={spec:'chara_card_v2',spec_version:'2.0',data:{name:'星河向导（PNG 测试）',description:'温和的星际旅行向导。',personality:'好奇、耐心。',scenario:'观星台',first_mes:'你好，{{user}}，一起看看今晚的星空吧。',mes_example:'{{user}}: 那是什么？\n{{char}}: 是一颗遥远的恒星。',extensions:{test:{preserved:true}}}};
export function chunk(type,data){const header=Buffer.alloc(8);header.writeUInt32BE(data.length);header.write(type,4);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4),data])));return Buffer.concat([header,data,crc]);}
export function pngFixture({card=cardFixture,text,extra=[],width=64,height=64}={}){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 const scan=Buffer.alloc(64*(1+64*4));
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=y*257+1+x*4;scan[i]=40+x;scan[i+1]=75+y;scan[i+2]=105+x;scan[i+3]=255;}
 const metadata=text===null?[]:[chunk('tEXt',Buffer.from('chara\0'+(text??Buffer.from(JSON.stringify(card)).toString('base64'))))];
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),...metadata,...extra,chunk('IEND',Buffer.alloc(0))]);
}
