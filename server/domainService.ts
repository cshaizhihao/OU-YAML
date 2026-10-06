import { randomBytes, randomUUID } from 'node:crypto';
import { db, hashToken } from './db';
import type { MihomoConfig, ProxyNode, TargetFormat } from '../src/shared/types';

function now() { return new Date().toISOString(); }
function readJson<T>(value: unknown, fallback: T): T { try { return JSON.parse(String(value)) as T; } catch { return fallback; } }

export function migrateLegacyProjects(userId: string) {
  const projects = db.prepare('SELECT id, name, config_json, created_at, updated_at FROM projects WHERE user_id = ?').all(userId) as Record<string, unknown>[];
  const created = db.transaction(() => {
    let count = 0;
    for (const project of projects) {
      const sourceId = `legacy-${String(project.id)}`;
      const exists = db.prepare('SELECT id FROM node_sources WHERE id = ?').get(sourceId);
      if (!exists) {
        const stamp = String(project.updated_at || project.created_at || now());
        db.prepare(`INSERT INTO node_sources (id,user_id,name,kind,format,enabled,node_count,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(sourceId, userId, `${String(project.name)} · 旧项目`, 'file', 'auto', 1, 0, stamp, stamp);
      }
      const config = readJson<MihomoConfig>(project.config_json, {} as unknown as MihomoConfig);
      for (const node of config.proxies || []) {
        const managedId = `legacy-node-${String(project.id)}-${node.id}`;
        if (db.prepare('SELECT id FROM managed_nodes WHERE id = ?').get(managedId)) continue;
        const stamp = String(project.updated_at || project.created_at || now());
        db.prepare(`INSERT INTO managed_nodes
          (id,user_id,source_id,name,type,server,port,config_json,raw_config_json,enabled,tags_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(managedId, userId, sourceId, node.name, node.type, node.server, node.port, JSON.stringify(node), JSON.stringify(node.extra || {}), 1, '[]', stamp, stamp);
        count += 1;
      }
      db.prepare('UPDATE node_sources SET node_count = (SELECT COUNT(*) FROM managed_nodes WHERE source_id = ?) WHERE id = ?').run(sourceId, sourceId);
    }
    return count;
  })();
  return created;
}

export function listNodeSources(userId: string) {
  migrateLegacyProjects(userId);
  return (db.prepare('SELECT * FROM node_sources WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Record<string, unknown>[]).map(row => ({
    id: String(row.id), userId: String(row.user_id), name: String(row.name), kind: String(row.kind), url: row.url ? String(row.url) : undefined,
    format: String(row.format), enabled: Boolean(row.enabled), nodeCount: Number(row.node_count), lastUpdatedAt: row.last_updated_at ? String(row.last_updated_at) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function listManagedNodes(userId: string, sourceId?: string) {
  migrateLegacyProjects(userId);
  const rows = (sourceId ? db.prepare('SELECT * FROM managed_nodes WHERE user_id = ? AND source_id = ? ORDER BY updated_at DESC').all(userId, sourceId) : db.prepare('SELECT * FROM managed_nodes WHERE user_id = ? ORDER BY updated_at DESC').all(userId)) as Record<string, unknown>[];
  return rows.map(row => ({ ...readJson<ProxyNode>(row.config_json, { id: String(row.id), name: String(row.name), type: String(row.type), server: String(row.server), port: Number(row.port), extra: {} }), id: String(row.id), userId: String(row.user_id), sourceId: row.source_id ? String(row.source_id) : undefined, enabled: Boolean(row.enabled), tags: readJson<string[]>(row.tags_json, []), note: row.note ? String(row.note) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export function createNodeSource(userId: string, input: { name: string; kind: string; url?: string; format?: string }) {
  const id = randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO node_sources (id,user_id,name,kind,url,format,enabled,node_count,created_at,updated_at) VALUES (?,?,?,?,?,?,1,0,?,?)`).run(id, userId, input.name, input.kind, input.url || null, input.format || 'auto', stamp, stamp);
  return listNodeSources(userId).find(item => item.id === id)!;
}

export function createManagedNode(userId: string, input: ProxyNode & { sourceId?: string; tags?: string[]; note?: string }) {
  const id = input.id || randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO managed_nodes (id,user_id,source_id,name,type,server,port,config_json,raw_config_json,enabled,tags_json,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, input.sourceId || null, input.name, input.type, input.server, input.port, JSON.stringify({ ...input, id }), JSON.stringify(input.extra || {}), 1, JSON.stringify(input.tags || []), input.note || null, stamp, stamp);
  return listManagedNodes(userId).find(item => item.id === id)!;
}

export function deleteManagedNode(userId: string, id: string) { return db.prepare('DELETE FROM managed_nodes WHERE id = ? AND user_id = ?').run(id, userId).changes > 0; }

export function createProfile(userId: string, input: { name: string; targetFormat: TargetFormat; config: MihomoConfig; nodeIds?: string[]; sourceIds?: string[]; templateId?: string }) {
  const id = randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO generation_profiles (id,user_id,name,target_format,config_json,node_ids_json,source_ids_json,template_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, input.name, input.targetFormat, JSON.stringify(input.config), JSON.stringify(input.nodeIds || []), JSON.stringify(input.sourceIds || []), input.templateId || null, 'active', stamp, stamp);
  return getProfile(userId, id);
}

export function getProfile(userId: string, id: string) {
  const row = db.prepare('SELECT * FROM generation_profiles WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return { id: String(row.id), userId: String(row.user_id), name: String(row.name), targetFormat: String(row.target_format) as TargetFormat, config: readJson<MihomoConfig>(row.config_json, {} as MihomoConfig), nodeIds: readJson<string[]>(row.node_ids_json, []), sourceIds: readJson<string[]>(row.source_ids_json, []), templateId: row.template_id ? String(row.template_id) : undefined, status: String(row.status), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function listProfiles(userId: string) { return (db.prepare('SELECT id FROM generation_profiles WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as { id: string }[]).map(item => getProfile(userId, item.id)!); }

export function publishSubscription(userId: string, profileId: string, name: string, targetFormat: TargetFormat, content: string, nodeCount: number, expiresAt?: string) {
  const profile = getProfile(userId, profileId); if (!profile) throw new Error('生成配置不存在');
  const id = randomUUID(); const token = randomBytes(32).toString('base64url'); const stamp = now();
  const previous = db.prepare('SELECT MAX(version) AS version FROM generated_subscriptions WHERE profile_id = ?').get(profileId) as { version?: number };
  db.prepare(`INSERT INTO generated_subscriptions (id,profile_id,user_id,name,target_format,token_hash,content,version,node_count,expires_at,revoked,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?)`).run(id, profileId, userId, name, targetFormat, hashToken(token), content, Number(previous?.version || 0) + 1, nodeCount, expiresAt || null, stamp, stamp);
  return { id, profileId, name, targetFormat, token, version: Number(previous?.version || 0) + 1, nodeCount, expiresAt, revoked: false, createdAt: stamp, updatedAt: stamp };
}

export function listPublishedSubscriptions(userId: string) {
  return (db.prepare('SELECT * FROM generated_subscriptions WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Record<string, unknown>[]).map(row => ({ id: String(row.id), profileId: String(row.profile_id), name: String(row.name), targetFormat: String(row.target_format), version: Number(row.version), nodeCount: Number(row.node_count), expiresAt: row.expires_at ? String(row.expires_at) : undefined, revoked: Boolean(row.revoked), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export function readPublicSubscription(token: string) {
  const row = db.prepare('SELECT * FROM generated_subscriptions WHERE (token_hash = ? OR id = ?) AND revoked = 0').get(hashToken(token), token) as Record<string, unknown> | undefined;
  if (!row || (row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now())) return undefined;
  return { content: String(row.content), targetFormat: String(row.target_format) as TargetFormat, name: String(row.name), version: Number(row.version) };
}

export function revokePublishedSubscription(userId: string, id: string) { return db.prepare("UPDATE generated_subscriptions SET revoked = 1, updated_at = ? WHERE id = ? AND user_id = ?").run(now(), id, userId).changes > 0; }
