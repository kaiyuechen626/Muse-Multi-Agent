// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { replaceFile } from '../src/atomic-file.mjs';

test('atomic replacement survives temporary sharing violations without removing the existing data', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'muse-atomic-'));
  try {
    const source = join(folder, 'new.tmp'), target = join(folder, 'chat.json');
    await writeFile(source, 'new conversation'); await writeFile(target, 'old conversation');
    let attempts = 0;
    await replaceFile(source, target, {
      renameFile: async (from, to) => {
        assert.equal(await readFile(to, 'utf8'), 'old conversation');
        if (++attempts <= 2) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
        await rename(from, to);
      }, wait: async () => {}
    });
    assert.equal(await readFile(target, 'utf8'), 'new conversation');
    assert.equal(attempts, 3);
    await assert.rejects(readFile(source), { code: 'ENOENT' });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('replacement gives up on persistent denial and immediately reports unrelated errors', async () => {
  for (const code of ['EACCES', 'ENOSPC']) {
    const failure = Object.assign(new Error(code), { code }); let attempts = 0;
    await assert.rejects(replaceFile('new.tmp', 'chat.json', {
      renameFile: async () => { attempts++; throw failure; }, wait: async () => {}
    }), error => error === failure);
    assert.ok(attempts <= 6);
    if (code === 'ENOSPC') assert.equal(attempts, 1);
  }
});
