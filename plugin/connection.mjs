// SPDX-License-Identifier: GPL-3.0-or-later
export const museUrl='http://127.0.0.1:3210/';
export async function connectionStatus(request=fetch){
  try{
    const response=await request(museUrl+'api/health',{signal:AbortSignal.timeout(2000),redirect:'error'});
    if(!response.ok)throw Error('unavailable');
    const body=await response.json();
    if(body.app!=='muse-multi-agent'||body.schemaVersion!==1)throw Error('wrong service');
    return {schemaVersion:1,mode:'local-launcher',connected:true,toolCallingEnabled:false};
  }catch{return {schemaVersion:1,mode:'local-launcher',connected:false,toolCallingEnabled:false};}
}
