// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { replaceFile } from './atomic-file.mjs';
export class Store {
  constructor(root) { this.root = root; this.onChange=null; this.onChangeError=null; }
  path(kind,id) {
    if (!['characters','chats','memories'].includes(kind) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效数据标识');
    return join(this.root,kind,`${id}.json`);
  }
  async init() { await Promise.all(['characters','chats','memories'].map(k => mkdir(join(this.root,k),{recursive:true}))); }
  async get(kind,id) { try { return JSON.parse(await readFile(this.path(kind,id),'utf8')); } catch(e) { if(e.code === 'ENOENT') return null; throw e; } }
  async list(kind) { const files = await readdir(join(this.root,kind)); return (await Promise.all(files.filter(f => f.endsWith('.json')).map(f => this.get(kind,f.slice(0,-5))))).sort((a,b) => b.updatedAt-a.updatedAt); }
  async put(kind,value) {
    const previous=this.onChange?await this.get(kind,value.id):null;
    const target = this.path(kind,value.id), temp = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temp,JSON.stringify(value,null,2),{flag:'wx'}); await replaceFile(temp,target); }
    finally { await unlink(temp).catch(e => { if(e.code !== 'ENOENT') throw e; }); }
    await this.notify(kind,value,previous);return value;
  }
  async notify(kind,value,previous){if(this.onChange)try{await this.onChange(kind,value,previous);}catch(error){this.onChangeError?.(error);}}
  async remove(kind,id) { const previous=this.onChange?await this.get(kind,id):null;await unlink(this.path(kind,id));await this.notify(kind,null,previous); }
}
