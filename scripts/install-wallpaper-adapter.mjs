// SPDX-License-Identifier: GPL-3.0-or-later
import {readFile,writeFile,copyFile,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const begin='/* MUSE_WALLPAPER_ADAPTER_BEGIN */',end='/* MUSE_WALLPAPER_ADAPTER_END */';
export function patchWallpaperClient(source,hook){
 const anchor='exports.apply = apply;';
 if(source.includes(begin)){
  const start=source.indexOf(begin),finish=source.indexOf(end,start);
  if(finish<0||source.indexOf(begin,start+1)>=0)throw Error('现有壁纸适配补丁不完整，停止安装');
  source=source.slice(0,start)+anchor+source.slice(finish+end.length);
 }
 if(source.split(anchor).length!==2)throw Error('壁纸插件客户端结构不匹配，未修改文件');
 for(const signature of ['function applySelection(','function serializeSelection(','function pushPersisted(','function keepPlayingWallpaper(','function persistSelection(','function apply(ctx)'])if(!source.includes(signature))throw Error('壁纸插件缺少兼容接口：'+signature);
 if(!hook.includes('function installMuseWallpaperControl()'))throw Error('壁纸适配代码无效');
 const replacement=begin+'\n'+hook+'\nexports.apply = function(ctx){const result=apply(ctx);if(ctx.effect)ctx.effect(()=>installMuseWallpaperControl());return result;};\n'+end;
 return source.replace(anchor,replacement);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=join(homedir(),'.dsh','profiles','desktop','node_modules','dsh-plugin-wallpaper-engine');
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 if(pkg.name!=='dsh-plugin-wallpaper-engine'||pkg.version!=='1.3.3')throw Error('当前壁纸适配仅验证 dsh-plugin-wallpaper-engine 1.3.3；未修改文件');
 const path=join(root,'lib','client.js'),source=await readFile(path,'utf8');
 const hook=await readFile(new URL('../plugin/wallpaper-client-hook.js',import.meta.url),'utf8'),patched=patchWallpaperClient(source,hook);
 const hash=createHash('sha256').update(source).digest('hex');
 const backup=path+'.muse-backup-'+hash.slice(0,12);
 if(patched!==source){
  try{await copyFile(path,backup,constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
  const temp=path+'.muse-tmp-'+randomUUID();await writeFile(temp,patched,'utf8');await rename(temp,path);
 }
 console.log(JSON.stringify({plugin:pkg.name,version:pkg.version,patched:true,changed:patched!==source,backup,sha256:createHash('sha256').update(patched).digest('hex')}));
}
