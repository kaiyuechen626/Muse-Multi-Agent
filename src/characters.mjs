// SPDX-License-Identifier: GPL-3.0-or-later
import { randomUUID } from 'node:crypto';
export function character(input, previous = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('角色必须为 JSON 对象');
  const result = { schemaVersion: 1, id: previous.id || randomUUID(), createdAt: previous.createdAt || Date.now(), updatedAt: Date.now() };
  for (const field of ['name','persona','scenario','greeting','examples','systemPrompt','postHistory','avatar','background','model']) {
    const value = input[field] ?? previous[field] ?? (field === 'model' ? 'deepseek-chat' : '');
    if (typeof value !== 'string' || value.length > (['avatar','background'].includes(field) ? 3000000 : 100000)) throw new Error(`${field} 格式或长度无效`);
    result[field] = value;
  }
  result.name = result.name.trim();
  if (!result.name || result.name.length > 100) throw new Error('角色名称必填，最多 100 字');
  if (!result.model.trim() || result.model.length > 100) throw new Error('模型 ID 必填，最多 100 字');
  for (const field of ['avatar','background']) if (result[field] && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(result[field])) throw new Error('图片请通过上传选择 PNG、JPEG 或 WebP');
  result.temperature = Number(input.temperature ?? previous.temperature ?? 0.8);
  result.maxTokens = Number(input.maxTokens ?? previous.maxTokens ?? 2048);
  if (!Number.isFinite(result.temperature) || result.temperature < 0 || result.temperature > 2) throw new Error('温度需在 0–2 之间');
  if (!Number.isInteger(result.maxTokens) || result.maxTokens < 1 || result.maxTokens > 8192) throw new Error('回复长度需在 1–8192 之间');
  result.cardMetadata = previous.cardMetadata || {};
  if(input.pinned!==undefined&&typeof input.pinned!=='boolean')throw new Error('角色置顶状态无效');
  result.pinned=input.pinned??previous.pinned??false;
  return result;
}
export function importCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('无效 JSON 角色卡');
  if(card.spec==='muse_character_card'){
    if(card.spec_version!=='1.0')throw new Error('不支持的 Muse 角色卡版本');
    return {character:character(card.assistant),warnings:[]};
  }
  let fields, metadata = {}, warnings = [];
  if (card.spec === 'chara_card_v2') {
    const d = card.data;
    if (!d || typeof d !== 'object' || !String(card.spec_version).startsWith('2.')) throw new Error('无效 SillyTavern V2 角色卡');
    fields = { name: d.name, persona: [d.description,d.personality].filter(Boolean).join('\n\n'), scenario:d.scenario, greeting:d.first_mes, examples:d.mes_example, systemPrompt:d.system_prompt, postHistory:d.post_history_instructions };
    metadata = { format:'chara_card_v2', data:d };
    if (d.character_book) warnings.push('世界书已保留，但本版不执行世界书检索。');
    if (d.alternate_greetings?.length) warnings.push('备用开场白已保留，本版使用主开场白。');
  } else {
    const d = card.assistant || card;
    if(!d || typeof d!=='object' || Array.isArray(d))throw new Error('Muse 角色内容必须为 JSON 对象');
    if (!('systemPrompt' in d || 'persona' in d || 'modelId' in d)) throw new Error('不支持的角色卡：请选择 Muse assistant.json 或 SillyTavern V2 JSON');
    fields = { name:d.name, persona:d.persona ?? d.systemPrompt, systemPrompt:d.persona ? d.systemPrompt : '', scenario:d.scenario, greeting:d.greeting, examples:d.examples, model:d.model ?? d.modelId ?? undefined, temperature:d.temperature ?? undefined, maxTokens:d.maxTokens ?? undefined, avatar:d.avatar, background:d.background };
    if (d.presetMessagesJson) {
      let presets; try { presets = JSON.parse(d.presetMessagesJson); } catch { throw new Error('Muse presetMessagesJson 不是有效 JSON'); }
      if (!Array.isArray(presets)) throw new Error('Muse 预设对话必须为数组');
      fields.examples ||= presets.filter(m => m && ['user','assistant'].includes(String(m.role).toLowerCase()) && typeof m.content === 'string').map(m => `${String(m.role).toLowerCase() === 'user' ? '{{user}}' : '{{char}}'}: ${m.content}`).join('\n');
    }
    if (d.avatarImageUrl || d.backgroundUrl) warnings.push('原卡本机图片路径不可移植，请重新上传头像／背景。');
    metadata = { format:'muse' };
  }
  const result = character(fields); result.cardMetadata = metadata;
  return { character:result, warnings };
}
export function substitute(text, role) { return text.replaceAll('{{char}}', role.name).replaceAll('{{user}}', '用户'); }
export function exportCard(role){
  const assistant={};
  for(const key of ['name','persona','scenario','greeting','examples','systemPrompt','postHistory','avatar','background','model','temperature','maxTokens'])assistant[key]=role[key];
  return {spec:'muse_character_card',spec_version:'1.0',assistant};
}
export function promptMessages(role, history) {
  const system = [`你正在扮演 ${role.name}。`,role.systemPrompt,role.persona,role.scenario && `场景背景：\n${role.scenario}`,role.examples && `以下仅为示例对话：\n${role.examples}`].filter(Boolean).join('\n\n');
  const messages = [{role:'system',content:substitute(system,role)}, ...history.map(m => ({role:m.role,content:m.content}))];
  if(role.memoryContext)messages.splice(1,0,{role:'system',content:role.memoryContext});
  if (role.postHistory) messages.push({role:'system',content:substitute(role.postHistory,role)});
  return messages;
}
