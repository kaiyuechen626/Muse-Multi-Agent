// SPDX-License-Identifier: GPL-3.0-or-later
// Same-process adapter contract, not a network login or global tool executor.
// resolveAgent must return a DSH Agent scope bound by trusted pairing/authorization.
export function createDshScopeAdapter(ctx,resolveAgent){
  if(typeof resolveAgent!=='function')throw new Error('A trusted Muse role to DSH agent binding is required');
  async function agentFor(roleId){const agent=await resolveAgent(roleId);if(!agent)throw new Error('Muse role has no authorized DSH agent binding');return agent;}
  return {
    async list({roleId}){const agent=await agentFor(roleId);return ctx.tools.schemas(agent).filter(t=>!t.name.startsWith('muse_'));},
    async invoke({roleId,chatId,callId,tool,args,signal}){
      if(!chatId||!callId||!signal)throw new Error('Missing call context');
      const agent=await agentFor(roleId);
      if(tool.startsWith('muse_')||!ctx.tools.schemas(agent).some(t=>t.name===tool))throw new Error('Tool unavailable in bound DSH scope');
      // Keep DSH pre-execute guards, approval, scheduling and cancellation in the path.
      // Never use ctx.tools.get(tool).execute(), or invent a parent execution token.
      return ctx.tools.execute({agent,callId,name:tool,arguments:args,signal});
    },
  };
}
