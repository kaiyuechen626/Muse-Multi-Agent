// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageBlocks } from '../web/message-format.js';
test('消息排版保留代码、中文换行及未闭合围栏',()=>{
 const blocks=messageBlocks('# 标题\r\n**强调**\n1. 第一项\n> 引用\n```js\n<script>alert(1)</script>\n```');
 assert.deepEqual(blocks.map(b=>b.type),['heading','paragraph','list','quote','code']);
 assert.equal(blocks.at(-1).text,'<script>alert(1)</script>');
 assert.equal(messageBlocks('````txt\n```\n内容\n````')[0].text,'```\n内容');
 assert.equal(messageBlocks('~~~\n未完成')[0].text,'未完成');
 assert.equal(messageBlocks('<img src=x onerror=alert(1)>')[0].type,'paragraph');
});
