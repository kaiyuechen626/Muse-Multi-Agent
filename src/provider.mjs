// SPDX-License-Identifier: GPL-3.0-or-later
import { promptMessages } from './characters.mjs';
export function connectionError(error) {
  if (error.name === 'AbortError') return new DOMException('已停止生成', 'AbortError');
  const code = error.cause?.code || error.code;
  if (['EACCES','EPERM'].includes(code)) return new Error('服务进程的网络访问被系统限制。请在本机双击 start-muse.cmd 重新启动服务，再填写 API Key 并重试。');
  if (error.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return new Error('连接 DeepSeek 超时，请检查网络后重试。');
  if (['ENOTFOUND','EAI_AGAIN'].includes(code)) return new Error('无法解析 api.deepseek.com，请检查网络或 DNS 设置。');
  if (['CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN'].includes(code)) return new Error('DeepSeek HTTPS 证书验证失败，请检查系统时间和网络代理证书。');
  return new Error('连接 DeepSeek 失败，请检查网络、防火墙或代理设置后重试。');
}
export async function readCompletionStream(response, onDelta) {
  if (!response.body) throw new Error('DeepSeek 未返回回复流');
  let buffer='', content='', finishReason=null, done=false;
  const decoder=new TextDecoder();
  function event(block) {
    const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim()==='[DONE]') { done=true; return; }
    let payload; try { payload=JSON.parse(data); } catch { throw new Error('DeepSeek 回复流格式无效，请重试'); }
    if (payload.error) throw new Error('DeepSeek 回复流中断，请重试');
    const choice=payload.choices?.[0], delta=choice?.delta?.content;
    if (typeof delta==='string' && delta) { content+=delta; onDelta(delta); }
    if (choice?.finish_reason) finishReason=choice.finish_reason;
  }
  try {
    for await (const chunk of response.body) {
      buffer+=decoder.decode(chunk,{stream:true});
      // Normalize only complete CRLF pairs; a CR can straddle network chunks.
      buffer=buffer.replaceAll('\r\n','\n');
      let end; while((end=buffer.indexOf('\n\n'))!==-1) { event(buffer.slice(0,end)); buffer=buffer.slice(end+2); if(done)break; }
      if(done)break;
      if(buffer.length>1000000)throw new Error('DeepSeek 回复流片段过大');
    }
  } catch(error) {
    if(error.name==='AbortError' || error instanceof TypeError)throw connectionError(error);
    throw error;
  }
  if(!done || !finishReason)throw new Error('DeepSeek 连接提前结束，已保留收到的文字');
  if(!content.trim())throw new Error('模型未返回有效文本，请重试');
  return {content,finishReason};
}
export async function complete(role,history,key,{fetchImpl=fetch,signal,onDelta}={}) {
  if (!key) throw new Error('请先在模型设置中填写 DeepSeek API Key');
  let response;
  try { response = await fetchImpl('https://api.deepseek.com/chat/completions', {
    method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
    body:JSON.stringify({model:role.model,messages:promptMessages(role,history),temperature:role.temperature,max_tokens:role.maxTokens,stream:!!onDelta}),
    signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)
  }); } catch (error) { throw connectionError(error); }
  if (!response.ok) throw new Error(({401:'API Key 无效',402:'DeepSeek 余额不足',429:'请求过于频繁，请稍后重试'}[response.status]) || `DeepSeek 请求失败（${response.status}）`);
  if(onDelta)return readCompletionStream(response,onDelta);
  let data;
  try { data = await response.json(); } catch (error) {
    if (error instanceof SyntaxError) throw new Error('DeepSeek 返回了无效响应，请稍后重试。');
    throw connectionError(error);
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型未返回有效文本，请重试');
  return { content, finishReason:data.choices[0].finish_reason || 'stop' };
}
