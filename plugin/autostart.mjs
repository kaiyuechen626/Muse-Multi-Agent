// SPDX-License-Identifier: GPL-3.0-or-later
import {readFile,access,mkdir} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join,isAbsolute} from 'node:path';
import {homedir} from 'node:os';

// Machine-local opt-in: no developer paths or credentials in the distributed plugin.
export function createMuseLauncher({configPath=join(homedir(),'.dsh','muse-launcher.json'),port=3210,timeoutMs=10000,spawnImpl=spawn}={}) {
  let pending,lastAttempt=0;
  async function probe() {
    try {
      const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000),redirect:'error'});
      const body=await response.json();
      return response.ok&&body.app==='muse-multi-agent'&&body.schemaVersion===1?'ready':'occupied';
    } catch(error) {return error.cause?.code==='ECONNREFUSED'?'offline':'occupied';}
  }
  async function start() {
    const status=await probe();if(status!=='offline')return status==='ready';
    let config;
    try{config=JSON.parse(await readFile(configPath,'utf8'));}catch(error){if(error.code==='ENOENT')return false;throw Error('Muse 自动启动配置无法读取');}
    if(config.enabled!==true)return false;
    const {appDirectory,nodeExecutable}=config;
    if(typeof appDirectory!=='string'||!isAbsolute(appDirectory)||typeof nodeExecutable!=='string'||!isAbsolute(nodeExecutable))throw Error('Muse 自动启动路径无效');
    const pkg=JSON.parse(await readFile(join(appDirectory,'package.json'),'utf8'));
    if(pkg.name!=='muse-multi-agent')throw Error('Muse 自动启动目录不匹配');
    await access(join(appDirectory,'src','server.mjs'));await access(nodeExecutable);
    if(Date.now()-lastAttempt<15000)return false;
    lastAttempt=Date.now();
    await mkdir(join(appDirectory,'data'),{recursive:true});
    const log=openSync(join(appDirectory,'data','startup.log'),'a');
    let child,spawnError;
    try {
      child=spawnImpl(nodeExecutable,[join(appDirectory,'src','server.mjs')],{
        cwd:appDirectory,detached:true,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,PORT:String(port)}
      });
      child.on('error',()=>{spawnError=true;});child.unref();
    } finally {closeSync(log);}
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline) {
      if(await probe()==='ready')return true;
      if(spawnError||child.exitCode!==null)return false;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    return false;
  }
  return ()=>{if(!pending)pending=start().finally(()=>{pending=undefined;});return pending;};
}
export const ensureMuseRunning=createMuseLauncher();
