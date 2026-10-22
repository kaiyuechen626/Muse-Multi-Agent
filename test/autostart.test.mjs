// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {EventEmitter,once} from 'node:events';
import {spawn} from 'node:child_process';
import {createMuseLauncher} from '../plugin/autostart.mjs';

test('DSH startup launches hidden without a shell, joins concurrent checks and reuses a healthy service',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-autostart-'));
 const server=http.createServer((_req,res)=>res.end(JSON.stringify({app:'muse-multi-agent',schemaVersion:1})));
 const placeholder=http.createServer();placeholder.listen(0,'127.0.0.1');await once(placeholder,'listening');
 const port=placeholder.address().port;await new Promise(r=>placeholder.close(r));
 await mkdir(join(root,'src'));await writeFile(join(root,'src','server.mjs'),'');
 await writeFile(join(root,'package.json'),JSON.stringify({name:'muse-multi-agent'}));
 const configPath=join(root,'launcher.json');await writeFile(configPath,JSON.stringify({enabled:true,appDirectory:root,nodeExecutable:process.execPath}));
 let calls=0;
 const launch=createMuseLauncher({configPath,port,spawnImpl:(exe,args,options)=>{
  calls++;assert.equal(exe,process.execPath);assert.deepEqual(args,[join(root,'src','server.mjs')]);
  assert.equal(options.windowsHide,true);assert.equal(options.detached,true);assert.equal(options.shell,undefined);
  assert.equal(options.cwd,root);assert.equal(options.env.PORT,String(port));
  server.listen(port,'127.0.0.1');const child=new EventEmitter();child.exitCode=null;child.unref=()=>{};return child;
 }});
 try {
  assert.deepEqual(await Promise.all([launch(),launch(),launch()]),[true,true,true]);
  assert.equal(await launch(),true);assert.equal(calls,1);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('an unrelated service on the port is never replaced or treated as Muse',async()=>{
 const server=http.createServer((_req,res)=>res.end(JSON.stringify({app:'other',schemaVersion:1})));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const launch=createMuseLauncher({port:server.address().port,spawnImpl:()=>assert.fail('port already occupied')});
  assert.equal(await launch(),false);
 }finally{await new Promise(r=>server.close(r));}
});

test('a stopped service starts as a real background Node process and becomes healthy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-autostart-process-'));
 const reservation=http.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
 const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 await mkdir(join(root,'src'));await writeFile(join(root,'package.json'),JSON.stringify({name:'muse-multi-agent'}));
 await writeFile(join(root,'src','server.mjs'),"import http from 'node:http';http.createServer((_req,res)=>res.end(JSON.stringify({app:'muse-multi-agent',schemaVersion:1}))).listen(Number(process.env.PORT),'127.0.0.1');");
 const configPath=join(root,'launcher.json');await writeFile(configPath,JSON.stringify({enabled:true,appDirectory:root,nodeExecutable:process.execPath}));
 let child;
 try {
  const launch=createMuseLauncher({configPath,port,spawnImpl:(...args)=>(child=spawn(...args))});
  assert.equal(await launch(),true);assert.ok(child.pid);assert.equal(await launch(),true);
 }finally{
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
  await rm(root,{recursive:true,force:true});
 }
});
