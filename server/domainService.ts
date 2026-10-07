import { randomBytes, randomUUID } from 'node:crypto';
import { db, hashToken } from './db';
import type { MihomoConfig, ProxyNode, TargetFormat } from '../src/shared/types';
import { readMihomoConfig } from '../src/shared/schema';
import { validateConfig } from '../src/shared/mihomo';

function now() { return new Date().toISOString(); }
function readJson<T>(value: unknown, fallback: T): T { try { return JSON.parse(String(value)) as T; } catch { return fallback; } }
function readFlag(value: unknown) { return Number(value) === 1 || value === true; }
type ManagedNodeInput = Omit<ProxyNode, "id"> & { id?: string; sourceId?: string; tags?: string[]; note?: string };

function managedNodeIdentity(node: ProxyNode) {
  return [node.type, node.server, node.port, node.uuid || "", node.password || "", node.cipher || "", node.sni || "", node.network || "", node.wsPath || "", node.wsHost || "", node.grpcServiceName || "", node.udp ?? "", node.tls ?? "", node.skipCertVerify ?? "", JSON.stringify(node.extra || {}), JSON.stringify(node.formatExtra || {})].join("\u001f").toLowerCase();
}

function readManagedNode(row: Record<string, unknown>) {
  return {
    ...readJson<ProxyNode>(row.config_json, { id: String(row.id), name: String(row.name), type: String(row.type), server: String(row.server), port: Number(row.port), extra: {} }),
    id: String(row.id), userId: String(row.user_id), sourceId: row.source_id ? String(row.source_id) : undefined,
    enabled: readFlag(row.enabled), sortOrder: Number(row.sort_order || 0), tags: readJson<string[]>(row.tags_json, []),
    note: row.note ? String(row.note) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function migrateLegacyProjects(userId: string) {
  const projects = db.prepare('SELECT id, name, config_json, created_at, updated_at FROM projects WHERE user_id = ?').all(userId) as Record<string, unknown>[];
  const created = db.transaction(() => {
    let count = 0;
    let nextOrder = Number((db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM managed_nodes WHERE user_id = ?").get(userId) as { value: number }).value) + 1;
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
          (id,user_id,source_id,name,type,server,port,config_json,raw_config_json,enabled,sort_order,tags_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(managedId, userId, sourceId, node.name, node.type, node.server, node.port, JSON.stringify(node), JSON.stringify(node.extra || {}), 1, nextOrder++, '[]', stamp, stamp);
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
    format: String(row.format), enabled: readFlag(row.enabled), nodeCount: Number(row.node_count), lastUpdatedAt: row.last_updated_at ? String(row.last_updated_at) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function listManagedNodes(userId: string, sourceId?: string) {
  migrateLegacyProjects(userId);
  const rows = (sourceId ? db.prepare('SELECT * FROM managed_nodes WHERE user_id = ? AND source_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC').all(userId, sourceId) : db.prepare('SELECT * FROM managed_nodes WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC').all(userId)) as Record<string, unknown>[];
  return rows.map(readManagedNode);
}

export function createNodeSource(userId: string, input: { name: string; kind: string; url?: string; format?: string; enabled?: boolean }) {
  const id = randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO node_sources (id,user_id,name,kind,url,format,enabled,node_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)`).run(id, userId, input.name, input.kind, input.url || null, input.format || 'auto', input.enabled === false ? 0 : 1, stamp, stamp);
  return listNodeSources(userId).find(item => item.id === id)!;
}

export function updateNodeSource(userId: string, id: string, input: { name: string; kind: string; url?: string; format?: string; enabled?: boolean }) {
  const result = db.prepare("UPDATE node_sources SET name = ?, kind = ?, url = ?, format = ?, enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(input.name, input.kind, input.url || null, input.format || "auto", input.enabled === false ? 0 : 1, now(), id, userId);
  if (!result.changes) return undefined;
  return listNodeSources(userId).find(item => item.id === id);
}

export function markNodeSourceError(userId: string, id: string, message: string) {
  const stamp = now();
  const result = db.prepare("UPDATE node_sources SET last_error = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(message.slice(0, 500), stamp, id, userId);
  return result.changes > 0;
}

export function replaceManagedNodesForSource(userId: string, sourceId: string, incoming: ProxyNode[]) {
  const source = db.prepare("SELECT * FROM node_sources WHERE id = ? AND user_id = ?").get(sourceId, userId) as Record<string, unknown> | undefined;
  if (!source) throw new Error("节点来源不存在");
  const rows = db.prepare("SELECT * FROM managed_nodes WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC").all(userId) as Record<string, unknown>[];
  const existing = rows.filter((row) => String(row.source_id || "") === sourceId).map((row) => ({ row, node: readManagedNode(row) }));
  const otherNames = new Set(rows.filter((row) => String(row.source_id || "") !== sourceId).map((row) => String(row.name)));
  const usedNames = new Set(otherNames);
  const nodes = incoming.map((node) => {
    const base = node.name.trim() || `${node.type.toUpperCase()} 节点`;
    let name = base;
    let suffix = 2;
    while (usedNames.has(name)) name = `${base} ${suffix++}`;
    usedNames.add(name);
    return { ...node, name };
  });
  const byIdentity = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    const identity = managedNodeIdentity(node);
    byIdentity.set(identity, [...(byIdentity.get(identity) || []), index]);
    byName.set(node.name, [...(byName.get(node.name) || []), index]);
  });
  const consumed = new Set<number>();
  const matched = new Map<string, number>();
  const take = (candidates: number[] | undefined) => {
    const index = candidates?.find((candidate) => !consumed.has(candidate));
    if (index === undefined) return undefined;
    consumed.add(index);
    return index;
  };
  for (const item of existing) {
    const index = take(byIdentity.get(managedNodeIdentity(item.node))) ?? take(byName.get(item.node.name));
    if (index !== undefined) matched.set(String(item.row.id), index);
  }

  const desired: { node: ProxyNode; id: string; existing?: Record<string, unknown> }[] = [];
  for (const row of rows) {
    if (String(row.source_id || "") !== sourceId) {
      desired.push({ node: readManagedNode(row), id: String(row.id), existing: row });
      continue;
    }
    const index = matched.get(String(row.id));
    if (index !== undefined) desired.push({ node: nodes[index], id: String(row.id), existing: row });
  }
  nodes.forEach((node, index) => {
    if (!consumed.has(index)) desired.push({ node, id: randomUUID() });
  });

  const stamp = now();
  db.transaction(() => {
    db.prepare("DELETE FROM managed_nodes WHERE user_id = ? AND source_id = ?").run(userId, sourceId);
    const updateOrder = db.prepare("UPDATE managed_nodes SET sort_order = ? WHERE id = ? AND user_id = ?");
    const insert = db.prepare(`INSERT INTO managed_nodes
      (id,user_id,source_id,name,type,server,port,config_json,raw_config_json,enabled,sort_order,tags_json,note,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    desired.forEach((item, position) => {
      if (item.existing && String(item.existing.source_id || "") !== sourceId) {
        updateOrder.run(position, item.id, userId);
        return;
      }
      const previous = item.existing;
      insert.run(item.id, userId, sourceId, item.node.name, item.node.type, item.node.server, item.node.port, JSON.stringify({ ...item.node, id: item.id }), JSON.stringify(item.node.extra || {}), previous ? Number(previous.enabled) : 1, position, JSON.stringify(previous ? readJson<string[]>(previous.tags_json, []) : []), previous?.note || null, previous?.created_at || stamp, stamp);
    });
    db.prepare("UPDATE node_sources SET last_updated_at = ?, last_error = NULL, node_count = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(stamp, nodes.length, stamp, sourceId, userId);
  })();
  return { source: listNodeSources(userId).find((item) => item.id === sourceId)!, nodes: listManagedNodes(userId, sourceId) };
}

export function createManagedNode(userId: string, input: ManagedNodeInput) {
  const id = input.id || randomUUID(); const stamp = now();
  if (input.sourceId && !db.prepare("SELECT id FROM node_sources WHERE id = ? AND user_id = ?").get(input.sourceId, userId)) throw new Error("节点来源不存在");
  const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM managed_nodes WHERE user_id = ?").get(userId) as { value: number };
  db.prepare(`INSERT INTO managed_nodes (id,user_id,source_id,name,type,server,port,config_json,raw_config_json,enabled,sort_order,tags_json,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, input.sourceId || null, input.name, input.type, input.server, input.port, JSON.stringify({ ...input, id }), JSON.stringify(input.extra || {}), 1, Number(max.value) + 1, JSON.stringify(input.tags || []), input.note || null, stamp, stamp);
  if (input.sourceId) db.prepare("UPDATE node_sources SET node_count = (SELECT COUNT(*) FROM managed_nodes WHERE source_id = ?), updated_at = ? WHERE id = ? AND user_id = ?").run(input.sourceId, stamp, input.sourceId, userId);
  return listManagedNodes(userId).find(item => item.id === id)!;
}

export function updateManagedNode(userId: string, id: string, input: ManagedNodeInput) {
  const existing = db.prepare("SELECT * FROM managed_nodes WHERE id = ? AND user_id = ?").get(id, userId) as Record<string, unknown> | undefined;
  if (!existing) return undefined;
  const stamp = now();
  db.prepare(`UPDATE managed_nodes SET name = ?, type = ?, server = ?, port = ?, config_json = ?, raw_config_json = ?, tags_json = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(input.name, input.type, input.server, input.port, JSON.stringify({ ...input, id }), JSON.stringify(input.extra || {}), JSON.stringify(input.tags || []), input.note || null, stamp, id, userId);
  return listManagedNodes(userId).find(item => item.id === id);
}

export function reorderManagedNodes(userId: string, orderedIds: string[]) {
  const uniqueIds = [...new Set(orderedIds)];
  const rows = db.prepare("SELECT id, sort_order FROM managed_nodes WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC").all(userId) as { id: string; sort_order: number }[];
  const known = new Set(rows.map(row => row.id));
  if (uniqueIds.some(id => !known.has(id))) throw new Error("节点排序列表包含无权操作的节点");
  const selected = new Set(uniqueIds);
  const slots = rows.map((row, index) => selected.has(row.id) ? index : -1).filter(index => index >= 0);
  if (slots.length !== uniqueIds.length) throw new Error("节点排序列表不完整");
  db.transaction(() => {
    const update = db.prepare("UPDATE managed_nodes SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?");
    const stamp = now();
    uniqueIds.forEach((id, index) => update.run(slots[index], stamp, id, userId));
  })();
  return listManagedNodes(userId);
}

export function deleteManagedNode(userId: string, id: string) {
  const existing = db.prepare("SELECT source_id FROM managed_nodes WHERE id = ? AND user_id = ?").get(id, userId) as { source_id?: string } | undefined;
  const deleted = db.prepare('DELETE FROM managed_nodes WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  if (!deleted) return false;
  db.transaction(() => {
    const rows = db.prepare("SELECT id FROM managed_nodes WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC").all(userId) as { id: string }[];
    const update = db.prepare("UPDATE managed_nodes SET sort_order = ? WHERE id = ? AND user_id = ?");
    rows.forEach((row, index) => update.run(index, row.id, userId));
  })();
  if (existing?.source_id) db.prepare("UPDATE node_sources SET node_count = (SELECT COUNT(*) FROM managed_nodes WHERE source_id = ?), updated_at = ? WHERE id = ? AND user_id = ?").run(existing.source_id, now(), existing.source_id, userId);
  return true;
}

export function createProfile(userId: string, input: { name: string; targetFormat: TargetFormat; config: MihomoConfig; nodeIds?: string[]; sourceIds?: string[]; templateId?: string }) {
  const parsedConfig = readMihomoConfig(input.config);
  if (!parsedConfig.success) throw new Error("生成配置格式无效");
  const issues = validateConfig(input.config);
  if (issues.some((issue) => issue.level === "error")) throw new Error("生成配置存在错误，请先修复配置");
  const nodeIds = [...new Set(input.nodeIds || [])];
  const sourceIds = [...new Set(input.sourceIds || [])];
  if (nodeIds.length > 5000 || sourceIds.length > 500) throw new Error("生成配置引用数量超过限制");
  const configIds = new Set(input.config.proxies.map((node) => node.id));
  const referencedNodeIds = [...new Set([...nodeIds, ...configIds])];
  const managedRows = referencedNodeIds.length ? db.prepare(`SELECT id, user_id FROM managed_nodes WHERE id IN (${referencedNodeIds.map(() => '?').join(',')})`).all(...referencedNodeIds) as { id: string; user_id: string }[] : [];
  if (managedRows.some((row) => row.user_id !== userId)) throw new Error("生成配置包含无权使用的节点");
  const managedIds = new Set(managedRows.map((row) => row.id));
  if (nodeIds.some((id) => !managedIds.has(id) && !configIds.has(id))) throw new Error("生成配置包含无权使用的节点");
  if (sourceIds.length && Number((db.prepare(`SELECT COUNT(*) AS count FROM node_sources WHERE user_id = ? AND id IN (${sourceIds.map(() => '?').join(',')})`).get(userId, ...sourceIds) as { count: number }).count) !== sourceIds.length) throw new Error("生成配置包含无权使用的节点来源");
  if (input.templateId && !db.prepare("SELECT id FROM rule_templates WHERE id = ? AND (is_builtin = 1 OR user_id = ?)").get(input.templateId, userId)) throw new Error("规则模板不存在或无权使用");
  const id = randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO generation_profiles (id,user_id,name,target_format,config_json,node_ids_json,source_ids_json,template_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, input.name, input.targetFormat, JSON.stringify(input.config), JSON.stringify(nodeIds), JSON.stringify(sourceIds), input.templateId || null, 'active', stamp, stamp);
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
  if (profile.targetFormat !== targetFormat) throw new Error('发布格式与生成配置不一致');
  if (!content.trim() || content.length > 10_000_000) throw new Error('发布内容无效或超过 10MB');
  if (!Number.isInteger(nodeCount) || nodeCount < 0 || nodeCount > profile.config.proxies.length) throw new Error('节点数量无效');
  if (expiresAt && !Number.isFinite(new Date(expiresAt).getTime())) throw new Error('过期时间无效');
  const id = randomUUID(); const token = randomBytes(32).toString('base64url'); const stamp = now();
  const previous = db.prepare('SELECT MAX(version) AS version FROM generated_subscriptions WHERE profile_id = ?').get(profileId) as { version?: number };
  db.prepare(`INSERT INTO generated_subscriptions (id,profile_id,user_id,name,target_format,token_hash,content,version,node_count,expires_at,revoked,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(id, profileId, userId, name, targetFormat, hashToken(token), content, Number(previous?.version || 0) + 1, nodeCount, expiresAt || null, stamp, stamp);
  return { id, profileId, name, targetFormat, token, version: Number(previous?.version || 0) + 1, nodeCount, expiresAt, revoked: false, createdAt: stamp, updatedAt: stamp };
}

export function listPublishedSubscriptions(userId: string) {
  return (db.prepare('SELECT * FROM generated_subscriptions WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Record<string, unknown>[]).map(row => ({ id: String(row.id), profileId: String(row.profile_id), name: String(row.name), targetFormat: String(row.target_format), version: Number(row.version), nodeCount: Number(row.node_count), expiresAt: row.expires_at ? String(row.expires_at) : undefined, revoked: Boolean(row.revoked), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export function readPublicSubscription(token: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return undefined;
  const row = db.prepare('SELECT * FROM generated_subscriptions WHERE token_hash = ? AND revoked = 0').get(hashToken(token)) as Record<string, unknown> | undefined;
  if (!row || (row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now())) return undefined;
  return { content: String(row.content), targetFormat: String(row.target_format) as TargetFormat, name: String(row.name), version: Number(row.version) };
}

export function revokePublishedSubscription(userId: string, id: string) { return db.prepare("UPDATE generated_subscriptions SET revoked = 1, updated_at = ? WHERE id = ? AND user_id = ?").run(now(), id, userId).changes > 0; }

export function rotatePublishedSubscription(userId: string, id: string) {
  const token = randomBytes(32).toString('base64url');
  const result = db.prepare("UPDATE generated_subscriptions SET token_hash = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revoked = 0").run(hashToken(token), now(), id, userId);
  if (!result.changes) return undefined;
  return { token };
}

export function listRuleTemplates(userId: string) {
  const rows = db.prepare('SELECT * FROM rule_templates WHERE is_builtin = 1 OR user_id = ? ORDER BY is_builtin DESC, updated_at DESC').all(userId) as Record<string, unknown>[];
  return rows.map(row => ({ id: String(row.id), userId: row.user_id ? String(row.user_id) : undefined, name: String(row.name), description: String(row.description), targetFormat: String(row.target_format), content: readJson<unknown[]>(row.content_json, []), builtin: Boolean(row.is_builtin), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export function createRuleTemplate(userId: string, input: { name: string; description?: string; targetFormat: TargetFormat; content: unknown[] }) {
  const id = randomUUID(); const stamp = now();
  db.prepare('INSERT INTO rule_templates (id,user_id,name,description,target_format,content_json,is_builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)').run(id, userId, input.name, input.description || '', input.targetFormat, JSON.stringify(input.content), stamp, stamp);
  return listRuleTemplates(userId).find(item => item.id === id)!;
}

export function updateRuleTemplate(userId: string, id: string, input: { name: string; description?: string; targetFormat: TargetFormat; content: unknown[] }) {
  const result = db.prepare('UPDATE rule_templates SET name = ?, description = ?, target_format = ?, content_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND is_builtin = 0')
    .run(input.name, input.description || '', input.targetFormat, JSON.stringify(input.content), now(), id, userId);
  if (!result.changes) return undefined;
  return listRuleTemplates(userId).find((item) => item.id === id);
}

export function deleteRuleTemplate(userId: string, id: string) {
  return db.prepare('DELETE FROM rule_templates WHERE id = ? AND user_id = ? AND is_builtin = 0').run(id, userId).changes > 0;
}

export function listJobs(userId: string) {
  return (db.prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(userId) as Record<string, unknown>[]).map(row => ({ id: String(row.id), kind: String(row.kind), status: String(row.status), error: row.error ? String(row.error) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export function deleteNodeSource(userId: string, id: string) { return db.prepare("DELETE FROM node_sources WHERE id = ? AND user_id = ?").run(id, userId).changes > 0; }

export function recordJob(userId: string | undefined, kind: string, payload: unknown = {}) {
  const id = randomUUID(); const stamp = now();
  db.prepare("INSERT INTO jobs (id,user_id,kind,status,payload_json,created_at,updated_at) VALUES (?,?,?,'queued',?,?,?)").run(id, userId || null, kind, JSON.stringify(payload), stamp, stamp);
  return id;
}

export function updateJob(id: string, status: string, error?: string) { db.prepare("UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(status, error || null, now(), id); }

export function recordAudit(userId: string | undefined, action: string, resourceType: string, resourceId?: string, metadata: unknown = {}) { db.prepare("INSERT INTO audit_logs (id,user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), userId || null, action, resourceType, resourceId || null, JSON.stringify(metadata), now()); }

export function listProxyGroups(userId: string) {
  const rows = db.prepare('SELECT * FROM proxy_groups WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Record<string, unknown>[];
  return rows.map(row => ({ id: String(row.id), userId: String(row.user_id), name: String(row.name), type: String(row.type), config: readJson<Record<string, unknown>>(row.config_json, {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at), members: (db.prepare('SELECT * FROM proxy_group_members WHERE group_id = ? ORDER BY position ASC').all(String(row.id)) as Record<string, unknown>[]).map(member => ({ id: String(member.id), memberType: String(member.member_type), memberId: String(member.member_id), position: Number(member.position) })) }));
}

export function createProxyGroup(userId: string, input: { name: string; type: string; config?: Record<string, unknown>; members?: { memberType: string; memberId: string }[] }) {
  const id = randomUUID(); const stamp = now();
  db.transaction(() => {
    db.prepare('INSERT INTO proxy_groups (id,user_id,name,type,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, userId, input.name, input.type, JSON.stringify(input.config || {}), stamp, stamp);
    for (const [position, member] of (input.members || []).entries()) db.prepare('INSERT INTO proxy_group_members (id,group_id,member_type,member_id,position) VALUES (?,?,?,?,?)').run(randomUUID(), id, member.memberType, member.memberId, position);
  })();
  return listProxyGroups(userId).find(item => item.id === id)!;
}

export function listRuleSets(userId: string) {
  const rows = db.prepare('SELECT * FROM rule_sets WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Record<string, unknown>[];
  return rows.map(row => ({ id: String(row.id), userId: String(row.user_id), name: String(row.name), kind: String(row.kind), content: readJson<unknown[]>(row.content_json, []), enabled: Boolean(row.enabled), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export function createRuleSet(userId: string, input: { name: string; kind?: string; content: unknown[] }) {
  const id = randomUUID(); const stamp = now();
  db.prepare('INSERT INTO rule_sets (id,user_id,name,kind,content_json,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)').run(id, userId, input.name, input.kind || 'custom', JSON.stringify(input.content), stamp, stamp);
  return listRuleSets(userId).find(item => item.id === id)!;
}
