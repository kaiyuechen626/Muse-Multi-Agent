// SPDX-License-Identifier: GPL-3.0-or-later
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Store} from '../src/store.mjs';
import {MemoryLibrary} from '../src/memory-library.mjs';
import {KeyVault} from '../src/key-vault.mjs';
import {complete} from '../src/provider.mjs';
const data=fileURLToPath(new URL('../data/',import.meta.url)),store=new Store(data);await store.init();
const key=process.env.DEEPSEEK_API_KEY||await new KeyVault(data).load();if(!key)throw Error('没有已保存的模型连接；原文备份已保留，配置连接后会自动补整理。');
const library=new MemoryLibrary({root:resolve(process.env.MUSE_MEMORY_DIR||fileURLToPath(new URL('../../memory/',import.meta.url))),store,provider:complete,getKey:()=>key,onSummary:result=>console.log(JSON.stringify({completedDay:result.day,parts:result.parts}))});
await library.init();const result=await library.summarizePending({includeToday:process.argv.includes('--today')});console.log(JSON.stringify({...result,error:library.lastError}));
