// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export class Store {
  constructor(root) { this.root = root; }
  path(kind,id) {
    if (!['characters','chats','memories'].includes(kind) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效数据标识');
    return join(this.root,kind,`${id}.json`);
  }
  async init() { await Promise.all(['characters','chats','memories'].map(k => mkdir(join(this.root,k),{recursive:true}))); }
  async get(kind,id) { try { return JSON.parse(await readFile(this.path(kind,id),'utf8')); } catch(e) { if(e.code === 'ENOENT') return null; throw e; } }
  async list(kind) { const files = await readdir(join(this.root,kind)); return (await Promise.all(files.filter(f => f.endsWith('.json')).map(f => this.get(kind,f.slice(0,-5))))).sort((a,b) => b.updatedAt-a.updatedAt); }
  async put(kind,value) {
    const target = this.path(kind,value.id), temp = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temp,JSON.stringify(value,null,2),{flag:'wx'}); await rename(temp,target); }
    finally { await unlink(temp).catch(e => { if(e.code !== 'ENOENT') throw e; }); }
    return value;
  }
  async remove(kind,id) { await unlink(this.path(kind,id)); }
}
