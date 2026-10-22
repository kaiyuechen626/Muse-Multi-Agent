// SPDX-License-Identifier: GPL-3.0-or-later
import {cp,mkdir,readdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const destination=path.resolve(process.argv[2]||path.join(root,'dist',`Muse-Multi-Agent-${pkg.version}-source`));
await mkdir(path.dirname(destination),{recursive:true});await mkdir(destination);
const allowed=['src','web','test','plugin','licenses','scripts','.github','package.json','.gitignore','.gitattributes','start-muse.cmd','README.md','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','CHANGELOG.md','RELEASE_NOTES.md','CONTRIBUTING.md','SECURITY.md','.env.example'];
async function copy(source,target){const stat=await lstat(source);if(stat.isSymbolicLink())throw Error('Refusing link: '+source);if(stat.isDirectory()){await mkdir(target,{recursive:true});for(const n of await readdir(source))await copy(path.join(source,n),path.join(target,n));}else await cp(source,target,{errorOnExist:true,force:false});}
for(const name of allowed)await copy(path.join(root,name),path.join(destination,name));
await mkdir(path.join(destination,'docs'));for(const name of ['PROVENANCE.md','LIMITATIONS.md','VALIDATION.md','LAN_SYNC.md','QQ_CHANNEL.md','MEMORY_LIBRARY.md','CHAT_ROOMS.md','PUBLISHING.md'])await copy(path.join(root,'docs',name),path.join(destination,'docs',name));
const entries=[];
async function verify(dir){for(const name of await readdir(dir)){const file=path.join(dir,name),stat=await lstat(file);if(stat.isDirectory()){if(['data','node_modules','verification','.git'].includes(name))throw Error('Private directory: '+file);await verify(file);}else{const bytes=await readFile(file);const text=bytes.toString();if(/sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|[CD]:[\\/]Users[\\/]ASUS/i.test(text))throw Error('Review sensitive match: '+file);entries.push({path:path.relative(destination,file).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
await verify(destination);await writeFile(path.join(destination,'SOURCE-MANIFEST.json'),JSON.stringify({version:pkg.version,files:entries},null,2)+'\n');console.log(JSON.stringify({directory:destination,files:entries.length}));
