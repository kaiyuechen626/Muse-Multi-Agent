// SPDX-License-Identifier: GPL-3.0-or-later
import {randomUUID} from 'node:crypto';
// Transport-independent boundary. No role receives tools by default.
export class CapabilityRouter{
  #adapters=new Map();#grants=new Map();
  register(provider,adapter){if(!/^[a-z][a-z0-9-]{0,40}$/.test(provider)||this.#adapters.has(provider))throw new Error('Invalid capability provider');if(typeof adapter.list!=='function'||typeof adapter.invoke!=='function')throw new Error('Invalid adapter');this.#adapters.set(provider,adapter);return ()=>{this.#adapters.delete(provider);for(const grants of this.#grants.values())for(const key of grants)if(key.startsWith(provider+':'))grants.delete(key);};}
  // Only trusted application authorization UI may call grant/revoke; never model arguments.
  grant(roleId,provider,tool){if(!roleId||!this.#adapters.has(provider)||!tool)throw new Error('Invalid grant');const grants=this.#grants.get(roleId)||new Set();grants.add(`${provider}:${tool}`);this.#grants.set(roleId,grants);}
  revoke(roleId,provider,tool){this.#grants.get(roleId)?.delete(`${provider}:${tool}`);}
  async list(roleId){const result=[];for(const [provider,adapter] of this.#adapters)for(const tool of await adapter.list({roleId}))if(this.#grants.get(roleId)?.has(`${provider}:${tool.name}`))result.push({...structuredClone(tool),provider});return result;}
  async invoke({roleId,chatId,provider,tool,args,signal}){
    if(!roleId||!chatId)throw new Error('Role and chat identity required');
    const adapter=this.#adapters.get(provider);if(!adapter||!this.#grants.get(roleId)?.has(`${provider}:${tool}`))throw new Error('Tool is not authorized for this role');
    const visible=await adapter.list({roleId});if(!visible.some(t=>t.name===tool))throw new Error('Tool unavailable in current scope');
    if(!this.#grants.get(roleId)?.has(`${provider}:${tool}`)||this.#adapters.get(provider)!==adapter)throw new Error('Authorization revoked');
    const callId=randomUUID(),abort=signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);abort.throwIfAborted();
    return {protocolVersion:1,callId,roleId,chatId,provider,tool,result:await adapter.invoke({callId,roleId,chatId,tool,args:structuredClone(args),signal:abort})};
  }
}
