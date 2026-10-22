// SPDX-License-Identifier: GPL-3.0-or-later
import { spawn } from 'node:child_process';
import { mkdir,readFile,writeFile,rename,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertApiKey } from './api-key.mjs';

// Send secret bytes over stdin, never as a command argument or temporary plaintext file.
function dpapi(value,decrypt=false){
  if(process.platform!=='win32')return Promise.reject(new Error('本机加密保存仅支持 Windows'));
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; try { $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r)) } catch { exit 1 }`;
  return new Promise((resolve,reject)=>{
    const executable=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',settled=false;
    const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(new Error('Windows 密钥加解密失败，请使用原 Windows 账户或重新填写密钥')):resolve(result);};
    const timer=setTimeout(()=>{child.kill();done(true);},15000);
    child.on('error',()=>done(true));child.stdin.on('error',()=>done(true));child.stderr.resume();
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>16384){child.kill();done(true);}});
    child.on('close',code=>{if(code!==0||!output.trim()||!/^[A-Za-z0-9+/=\s]+$/.test(output))done(true);else done(false,Buffer.from(output.trim(),'base64'));});
    child.stdin.end(Buffer.from(value).toString('base64'));
  });
}
export class KeyVault{
  constructor(root){this.directory=join(root,'secrets');this.path=join(this.directory,'deepseek.dpapi');this.supported=process.platform==='win32';}
  async load(){
    let ciphertext;try{ciphertext=await readFile(this.path);}catch(e){if(e.code==='ENOENT')return '';throw new Error('无法读取已保存密钥');}
    const key=(await dpapi(ciphertext,true)).toString('utf8');
    return assertApiKey(key);
  }
  async save(key){
    assertApiKey(key);
    const encrypted=await dpapi(Buffer.from(key,'utf8'));
    await mkdir(this.directory,{recursive:true});const temp=this.path+'.'+randomUUID()+'.tmp';
    try{await writeFile(temp,encrypted,{flag:'wx'});await rename(temp,this.path);}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async clear(){await unlink(this.path).catch(e=>{if(e.code!=='ENOENT')throw new Error('无法清除已保存密钥');});}
}
