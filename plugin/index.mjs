// SPDX-License-Identifier: GPL-3.0-or-later
import { defineTool } from '@deepseek-ai/dsh-tools';
import {connectionStatus} from './connection.mjs';
import {installBridge} from './bridge.mjs';
export { createDshScopeAdapter } from './scope-adapter.mjs';
export const name = 'muse-multi-agent';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.inject(['webServer','agents'],child=>installBridge(child));
  ctx.inject(['webServer'],child=>{
    child.effect(()=>child.webServer.register({kind:'exact',path:'/muse-multi-agent/status',handler:async(req,res)=>{
      if(req.method!=='GET'){res.writeHead(405);return res.end();}
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(await connectionStatus()));
    }}));
  });
  ctx.tools.register(defineTool({
    name: 'muse_bridge_status',
    description: 'Check whether the local Muse app is running. Does not read chats, memories or keys, and does not grant tool access.',
    parameters: {},
    output: {
      schema: {type: 'object', additionalProperties: false, properties: {
        schemaVersion: {type: 'integer', required: true}, mode: {type: 'string', required: true},
        connected: {type:'boolean',required:true},toolCallingEnabled: {type:'boolean',required:true},
      }},
      render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}],
    },
    execute: async () => connectionStatus(),
  }));
}
