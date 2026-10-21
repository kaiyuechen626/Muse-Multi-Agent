// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionStatus,museUrl} from '../plugin/connection.mjs';
test('DSH launcher health: fixed loopback, no credentials, mismatch and disconnect fail closed',async()=>{
 const online=await connectionStatus(async(url,options)=>{assert.equal(url,museUrl+'api/health');assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);return {ok:true,json:async()=>({app:'muse-multi-agent',schemaVersion:1})};});
 assert.equal(online.connected,true);assert.equal(online.toolCallingEnabled,false);
 for(const request of [async()=>{throw Error('private failure');},async()=>({ok:false}),async()=>({ok:true,json:async()=>({app:'other'})})])assert.deepEqual(await connectionStatus(request),{schemaVersion:1,mode:'local-launcher',connected:false,toolCallingEnabled:false});
});
