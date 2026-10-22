// SPDX-License-Identifier: GPL-3.0-or-later
import { rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Windows readers and antivirus can briefly deny replacement of an existing file.
// Keep the old destination intact until rename succeeds; never unlink it first.
export async function replaceFile(source, target, { renameFile = rename, wait = delay } = {}) {
  const backoff = [10, 25, 50, 100, 200];
  for (let attempt = 0; ; attempt++) {
    try { await renameFile(source, target); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= backoff.length) throw error;
      await wait(backoff[attempt]);
    }
  }
}
