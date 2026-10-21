// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from 'node:crypto';

// Identity belongs to a paired library, never to a mutable display name.
export function stableId(libraryId, kind, localId) {
  for (const value of [libraryId, kind, localId]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Non-empty identity required');
  }
  return `muse:${kind}:${createHash('sha256').update(JSON.stringify([libraryId, kind, localId])).digest('hex')}`;
}
const array = (value = '[]') => {
  const result = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(result)) throw new Error('Expected array');
  return result;
};
export function convertBackup(backup, libraryId) {
  const id = (kind, key) => stableId(libraryId, kind, String(key ?? ''));
  const roles = (backup.assistants ?? []).map(a => ({
    id: id('role', a.id), sourceId: a.id, name: a.name,
    systemPrompt: a.systemPrompt ?? '', capabilities: array(a.capabilitiesJson),
    modelRef: {providerId: a.providerId ?? null, modelId: a.modelId ?? null},
    memoryPolicy: {enabled: a.memoryEnabled ?? true, useGlobal: a.useGlobalMemory ?? false},
  }));
  const roleIds = new Set(roles.map(r => r.id));
  const role = local => {
    const key = id('role', local);
    if (!roleIds.has(key)) throw new Error(`Unmapped role: ${local}`);
    return key;
  };
  const sessions = (backup.sessions ?? []).map(s => ({
    id: id('session', s.id), sourceId: s.id, roleId: role(s.assistantId ?? 'default'),
    title: s.title, deletedAt: s.deletedAt ?? null,
    parentSessionId: s.parentSessionId ? id('session', s.parentSessionId) : null,
  }));
  const sessionIds = new Set(sessions.map(s => s.id));
  const messages = (backup.messages ?? []).map(m => ({
    id: id('message', m.id), sourceId: m.id, sessionId: id('session', m.sessionId),
    speaker: m.role.toLowerCase(), content: m.content, createdAt: m.createdAt,
    seq: m.seq ?? 0, commitSeq: m.commitSeq ?? 0,
    parentMessageId: m.parentMessageId ? id('message', m.parentMessageId) : null,
    // Prototype preserves the complete message row, including branches and attachments.
    extensions: {muse: structuredClone(m)},
  }));
  const messageIds = new Set(messages.map(m => m.id));
  for (const m of messages) {
    if (!sessionIds.has(m.sessionId)) throw new Error('Orphan message');
    if (m.parentMessageId && !messageIds.has(m.parentMessageId)) throw new Error('Missing branch parent');
  }
  const memories = [];
  const addFact = (f, databaseRole = null) => {
    if (!Number.isSafeInteger(f.id) || f.id <= 0) throw new Error('Unsafe fact identity');
    const owner = databaseRole ?? (f.scope === 'main' || !f.scope ? 'default' : f.scope);
    if (databaseRole && f.scope && !['main', databaseRole].includes(f.scope)) throw new Error('Conflicting fact scope');
    memories.push({
      id: id('memory', JSON.stringify([databaseRole ?? 'main-db', f.id])),
      roleId: role(owner), spaceId: id('space', f.spaceId ?? 'default'), text: f.fact,
      sourceSessionId: f.sessionId ? id('session', f.sessionId) : null,
      extensions: {muse: structuredClone(f)},
    });
  };
  for (const f of backup.facts ?? []) addFact(f);
  for (const [owner, facts] of Object.entries(backup.scopedFacts ?? {})) for (const f of facts) addFact(f, owner);
  for (const items of [roles, sessions, messages, memories]) {
    if (new Set(items.map(x => x.id)).size !== items.length) throw new Error('Duplicate source identity');
  }
  return {schemaVersion: 1, libraryId, roles, sessions, messages, memories};
}

// Prototype snapshot merge: duplicates are idempotent; divergence requires explicit resolution.
export function mergeRecords(current, incoming) {
  const result = new Map(current.map(r => [r.id, structuredClone(r)]));
  for (const record of incoming) {
    if (result.has(record.id) && JSON.stringify(result.get(record.id)) !== JSON.stringify(record)) {
      throw new Error(`Conflict: ${record.id}`);
    }
    result.set(record.id, structuredClone(record));
  }
  return [...result.values()];
}
export function memoriesFor(bundle, roleId, spaceId) {
  const actor = bundle.roles.find(r => r.id === roleId);
  if (!actor?.memoryPolicy.enabled) return [];
  const globalRole = bundle.roles.find(r => r.sourceId === 'default')?.id;
  return bundle.memories.filter(m => m.spaceId === spaceId && (
    (m.roleId === roleId && roleId !== globalRole) ||
    (m.roleId === globalRole && actor.memoryPolicy.useGlobal)
  ));
}
