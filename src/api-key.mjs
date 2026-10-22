// SPDX-License-Identifier: GPL-3.0-or-later
export function assertApiKey(key) {
  if (!key) throw new Error('请先在模型设置中填写 DeepSeek API Key');
  if (typeof key !== 'string' || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new Error('DeepSeek API Key 格式无效：不能包含中文、空格或控制字符，请在模型设置中重新填写有效密钥。');
  }
  return key;
}
