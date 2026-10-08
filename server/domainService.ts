import { randomBytes, randomUUID } from 'node:crypto';
import { db, hashToken } from './db';
import type { MihomoConfig, ProxyNode, TargetFormat } from '../src/shared/types';
import { readMihomoConfig } from '../src/shared/schema';
import { validateConfig } from '../src/shared/mihomo';
import { previewExport } from "../src/shared/exportConfig";
import { sealToken } from './tokenVault';
import { addCountryFlag, countryFlagForRename } from '../src/shared/nodeNames';

function now() { return new Date().toISOString(); }
function readJson<T>(value: unknown, fallback: T): T { try { return JSON.parse(String(value)) as T; } catch { return fallback; } }
function readFlag(value: unknown) { return Number(value) === 1 || value === true; }
type ManagedNodeInput = Omit<ProxyNode, "id"> & { id?: string; sourceId?: string; enabled?: boolean; tags?: string[]; note?: string };
type NodeSourceInput = { name: string; kind: string; url?: string; format?: string; enabled?: boolean; intervalMinutes?: number; userAgent?: string; skipCertVerify?: boolean };

function stripManagedMetadata(node: ProxyNode & { userId?: string; sourceId?: string; enabled?: boolean; sortOrder?: number; tags?: string[]; note?: string; createdAt?: string; updatedAt?: string }) {
  const { userId: _userId, sourceId: _sourceId, enabled: _enabled, sortOrder: _sortOrder, tags: _tags, note: _note, createdAt: _createdAt, updatedAt: _updatedAt, ...config } = node;
  return config as ProxyNode;
}

function managedInputConfig(input: ManagedNodeInput, id: string) {
  return stripManagedMetadata({ ...input, id } as ProxyNode & ManagedNodeInput);
}

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

function managedNodeConfig(row: Record<string, unknown>) {
  return stripManagedMetadata(readManagedNode(row));
}

function projectNodeOverrides(base: ProxyNode, node: ProxyNode) {
  const values: Record<string, unknown> = {};
  const unset: string[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(node)]);
  keys.delete("id");
  keys.delete("name");
  for (const key of keys) {
    const baseValue = (base as unknown as Record<string, unknown>)[key];
    const nodeValue = (node as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(baseValue) === JSON.stringify(nodeValue)) continue;
    if (nodeValue === undefined) unset.push(key);
    else values[key] = nodeValue;
  }
  return { values, unset };
}

function proxyConfigChanged(base: ProxyNode, next: ProxyNode) {
  const difference = projectNodeOverrides(base, next);
  return Object.keys(difference.values).length > 0 || difference.unset.length > 0;
}

function applyProjectNodeOverrides(base: ProxyNode, alias: string, id: string, value: unknown) {
  const stored = readJson<{ values?: Record<string, unknown>; unset?: string[] }>(value, {});
  const values = stored.values && typeof stored.values === "object" ? stored.values : stored as unknown as Record<string, unknown>;
  const next = { ...base, ...values, id, name: alias } as ProxyNode;
  for (const key of Array.isArray(stored.unset) ? stored.unset : []) delete (next as unknown as Record<string, unknown>)[key];
  return next;
}

function removeProjectNodeReferences(userId: string, nodeIds: string[]) {
  const ids = [...new Set(nodeIds)];
  if (!ids.length) return;
  const idSet = new Set(ids);
  const placeholders = ids.map(() => "?").join(",");
  const bindings = db.prepare(`SELECT project_nodes.project_id, project_nodes.node_id, project_nodes.alias
    FROM project_nodes JOIN projects ON projects.id = project_nodes.project_id
    WHERE projects.user_id = ? AND project_nodes.node_id IN (${placeholders})`).all(userId, ...ids) as { project_id: string; node_id: string; alias: string }[];
  const aliasesByProject = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const aliases = aliasesByProject.get(binding.project_id) || new Set<string>();
    aliases.add(binding.alias);
    aliasesByProject.set(binding.project_id, aliases);
  }
  const projects = db.prepare("SELECT id, config_json, updated_at FROM projects WHERE user_id = ?").all(userId) as { id: string; config_json: string; updated_at: string }[];
  const update = db.prepare("UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ? AND user_id = ?");
  for (const project of projects) {
    const config = readJson<MihomoConfig>(project.config_json, {} as MihomoConfig);
    if (!Array.isArray(config.proxies) || !Array.isArray(config.proxyGroups) || !Array.isArray(config.rules)) continue;
    const removedNames = aliasesByProject.get(project.id) || new Set<string>();
    for (const node of config.proxies) if (idSet.has(node.id)) removedNames.add(node.name);
    if (!removedNames.size && !config.proxies.some((node) => idSet.has(node.id))) continue;
    const next: MihomoConfig = {
      ...config,
      proxies: config.proxies.filter((node) => !idSet.has(node.id) && !removedNames.has(node.name)),
      proxyGroups: config.proxyGroups.map((group) => ({ ...group, proxies: group.proxies.filter((member) => !removedNames.has(member)) })),
      rules: config.rules.map((rule) => removedNames.has(rule.target) ? { ...rule, target: "DIRECT" } : rule),
    };
    const previousTime = Number.isFinite(new Date(project.updated_at).getTime()) ? new Date(project.updated_at).getTime() : 0;
    const updatedAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
    update.run(JSON.stringify(next), updatedAt, project.id, userId);
  }
  db.prepare(`DELETE FROM project_nodes WHERE node_id IN (${placeholders}) AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`).run(...ids, userId);
}

function normalizeManagedNodeOrder(userId: string) {
  const rows = db.prepare("SELECT id FROM managed_nodes WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC").all(userId) as { id: string }[];
  const update = db.prepare("UPDATE managed_nodes SET sort_order = ? WHERE id = ? AND user_id = ?");
  rows.forEach((row, index) => update.run(index, row.id, userId));
}

function touchProjectsForNodes(userId: string, nodeIds: string[]) {
  const ids = [...new Set(nodeIds)];
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  const projects = db.prepare(`SELECT DISTINCT projects.id, projects.updated_at
    FROM projects JOIN project_nodes ON project_nodes.project_id = projects.id
    WHERE projects.user_id = ? AND project_nodes.node_id IN (${placeholders})`).all(userId, ...ids) as { id: string; updated_at: string }[];
  const update = db.prepare("UPDATE projects SET updated_at = ? WHERE id = ? AND user_id = ?");
  let timestamp = Date.now();
  for (const project of projects) {
    const previous = Number.isFinite(new Date(project.updated_at).getTime()) ? new Date(project.updated_at).getTime() : 0;
    timestamp = Math.max(timestamp, previous + 1);
    update.run(new Date(timestamp).toISOString(), project.id, userId);
  }
}

function renameNodeAliases(userId: string, nodeId: string, previousName: string, nextName: string) {
  const flag = countryFlagForRename(previousName, nextName);
  if (previousName === nextName && !flag) return;
  const nextAlias = (alias: string) => {
    const name = alias === previousName ? nextName : flag ? addCountryFlag(alias, flag, Infinity) : alias;
    if (name.length > 200) throw new Error(`添加国旗后别名超过 200 字符：${alias}`);
    return name;
  };
  const renameConfig = (config: MihomoConfig, previousAlias: string, alias: string, scope: string, bindings: { node_id: string; alias: string }[] = []) => {
    const names = new Set([previousAlias, ...config.proxies.filter((node) => node.id === nodeId).map((node) => node.name)]);
    const otherNames = [...config.proxies.filter((node) => node.id !== nodeId).map((node) => node.name), ...config.proxyGroups.map((group) => group.name), ...bindings.filter((binding) => binding.node_id !== nodeId).map((binding) => binding.alias), "DIRECT", "REJECT", "REJECT-DROP", "PASS", "GLOBAL"];
    if (otherNames.includes(alias) || otherNames.some((name) => names.has(name))) throw new Error(`${scope}存在节点名称冲突：${alias}，请先调整别名`);
    const rename = (name: string) => names.has(name) ? alias : name;
    return {
      ...config,
      proxies: config.proxies.map((node) => node.id === nodeId ? { ...node, name: alias } : node),
      proxyGroups: config.proxyGroups.map((group) => ({ ...group, proxies: group.proxies.map(rename) })),
      rules: config.rules.map((rule) => ({ ...rule, target: rename(rule.target) })),
    };
  };
  const projects = db.prepare(`SELECT projects.id, projects.name, projects.config_json, projects.updated_at, project_nodes.alias
    FROM projects LEFT JOIN project_nodes ON project_nodes.project_id = projects.id AND project_nodes.node_id = ?
    WHERE projects.user_id = ?`)
    .all(nodeId, userId) as { id: string; name: string; config_json: string; updated_at: string; alias: string | null }[];
  const updateProject = db.prepare("UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ? AND user_id = ?");
  const updateAlias = db.prepare("UPDATE project_nodes SET alias = ?, updated_at = ? WHERE project_id = ? AND node_id = ? AND alias = ?");
  for (const project of projects) {
    const config = readJson<MihomoConfig>(project.config_json, {} as MihomoConfig);
    const previousAlias = project.alias ?? config.proxies?.find((node) => node.id === nodeId)?.name;
    if (previousAlias === undefined) continue;
    const alias = nextAlias(previousAlias);
    if (alias === previousAlias && !config.proxies?.some((node) => node.id === nodeId && node.name !== alias)) continue;
    if (!Array.isArray(config.proxies) || !Array.isArray(config.proxyGroups) || !Array.isArray(config.rules)) throw new Error(`项目“${project.name}”配置无效，无法同步节点名称`);
    const bindings = db.prepare("SELECT node_id, alias FROM project_nodes WHERE project_id = ?").all(project.id) as { node_id: string; alias: string }[];
    const next = renameConfig(config, previousAlias, alias, `项目“${project.name}”`, bindings);
    const updatedAt = new Date(Math.max(Date.now(), new Date(project.updated_at).getTime() + 1 || 0)).toISOString();
    updateAlias.run(alias, updatedAt, project.id, nodeId, previousAlias);
    updateProject.run(JSON.stringify(next), updatedAt, project.id, userId);
  }
  for (const profile of listProfiles(userId)) {
    const config = profile.config;
    const previousAlias = config.proxies.find((node) => node.id === nodeId)?.name;
    if (previousAlias === undefined) continue;
    const alias = nextAlias(previousAlias);
    if (alias === previousAlias) continue;
    const next = renameConfig(config, previousAlias, alias, `生成配置“${profile.name}”`);
    const updatedAt = new Date(Math.max(Date.now(), new Date(profile.updatedAt).getTime() + 1)).toISOString();
    db.prepare("UPDATE generation_profiles SET config_json = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(next), updatedAt, profile.id, userId);
  }
}

export function syncProjectNodes(userId: string, projectId: string, proxies: ProxyNode[]) {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId);
  if (!project) throw new Error("项目不存在");
  const stamp = now();
  const rows = db.prepare("SELECT * FROM managed_nodes WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC").all(userId) as Record<string, unknown>[];
  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const rowsByIdentity = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const identity = managedNodeIdentity(managedNodeConfig(row));
    rowsByIdentity.set(identity, [...(rowsByIdentity.get(identity) || []), row]);
  }
  const usedNodeIds = new Set<string>();
  let nextOrder = Number((db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM managed_nodes WHERE user_id = ?").get(userId) as { value: number }).value) + 1;
  const normalized: ProxyNode[] = [];

  db.transaction(() => {
    const upsertBinding = db.prepare(`INSERT INTO project_nodes
      (project_id,node_id,alias,enabled,sort_order,overrides_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,node_id) DO UPDATE SET alias=excluded.alias, enabled=excluded.enabled, sort_order=excluded.sort_order, overrides_json=excluded.overrides_json, updated_at=excluded.updated_at`);
    const insertNode = db.prepare(`INSERT INTO managed_nodes
      (id,user_id,source_id,name,type,server,port,config_json,raw_config_json,enabled,sort_order,tags_json,note,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    proxies.forEach((node, position) => {
      let row = rowsById.get(node.id);
      if (row && (String(row.user_id) !== userId || usedNodeIds.has(String(row.id)))) row = undefined;
      if (!row) row = rowsByIdentity.get(managedNodeIdentity(node))?.find((candidate) => !usedNodeIds.has(String(candidate.id)));
      if (!row) {
        let id = node.id;
        if (!id || db.prepare("SELECT id FROM managed_nodes WHERE id = ?").get(id)) id = randomUUID();
        const stored = { ...node, id };
        insertNode.run(id, userId, null, node.name, node.type, node.server, node.port, JSON.stringify(stored), JSON.stringify(node.extra || {}), 1, nextOrder++, "[]", null, stamp, stamp);
        row = db.prepare("SELECT * FROM managed_nodes WHERE id = ?").get(id) as Record<string, unknown>;
        rowsById.set(id, row);
        const identity = managedNodeIdentity(stored);
        rowsByIdentity.set(identity, [...(rowsByIdentity.get(identity) || []), row]);
      }
      const nodeId = String(row.id);
      usedNodeIds.add(nodeId);
      const base = managedNodeConfig(row);
      const overrides = projectNodeOverrides(base, node);
      upsertBinding.run(projectId, nodeId, node.name, 1, position, JSON.stringify(overrides), stamp, stamp);
      normalized.push(applyProjectNodeOverrides(base, node.name, nodeId, overrides));
    });
    const existing = db.prepare("SELECT node_id FROM project_nodes WHERE project_id = ?").all(projectId) as { node_id: string }[];
    const remove = db.prepare("DELETE FROM project_nodes WHERE project_id = ? AND node_id = ?");
    for (const item of existing) if (!usedNodeIds.has(item.node_id)) remove.run(projectId, item.node_id);
  })();
  return normalized;
}

export function readProjectNodes(userId: string, projectId: string, fallback: ProxyNode[] = []) {
  let rows = db.prepare(`SELECT project_nodes.*, managed_nodes.config_json
    FROM project_nodes JOIN managed_nodes ON managed_nodes.id = project_nodes.node_id
    WHERE project_nodes.project_id = ? AND managed_nodes.user_id = ?
    ORDER BY project_nodes.sort_order ASC`).all(projectId, userId) as Record<string, unknown>[];
  if (!rows.length && fallback.length) {
    syncProjectNodes(userId, projectId, fallback);
    rows = db.prepare(`SELECT project_nodes.*, managed_nodes.config_json
      FROM project_nodes JOIN managed_nodes ON managed_nodes.id = project_nodes.node_id
      WHERE project_nodes.project_id = ? AND managed_nodes.user_id = ?
      ORDER BY project_nodes.sort_order ASC`).all(projectId, userId) as Record<string, unknown>[];
  }
  return rows.filter((row) => readFlag(row.enabled)).map((row) => applyProjectNodeOverrides(
    stripManagedMetadata(readJson<ProxyNode>(row.config_json, {} as ProxyNode)),
    String(row.alias),
    String(row.node_id),
    row.overrides_json,
  ));
}

export function hydrateProject(row: Record<string, unknown>) {
  const config = readJson<MihomoConfig>(row.config_json, {} as MihomoConfig);
  const userId = String(row.user_id);
  config.proxies = readProjectNodes(userId, String(row.id), config.proxies || []);
  return {
    id: String(row.id),
    name: String(row.name),
    updatedAt: String(row.updated_at),
    config,
    targetFormat: (row.target_format === "sing-box" ? "sing-box" : "mihomo") as TargetFormat,
  };
}

export function migrateLegacyProjects(userId: string) {
  const projects = db.prepare("SELECT id, config_json FROM projects WHERE user_id = ?").all(userId) as Record<string, unknown>[];
  let created = 0;
  for (const project of projects) {
    const existing = Number((db.prepare("SELECT COUNT(*) AS count FROM project_nodes WHERE project_id = ?").get(project.id) as { count: number }).count);
    const config = readJson<MihomoConfig>(project.config_json, {} as MihomoConfig);
    if (!existing && config.proxies?.length) {
      syncProjectNodes(userId, String(project.id), config.proxies);
      created += config.proxies.length;
    }
  }
  return created;
}

export function listNodeSources(userId: string) {
  migrateLegacyProjects(userId);
  return (db.prepare('SELECT * FROM node_sources WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Record<string, unknown>[]).map(row => ({
    id: String(row.id), userId: String(row.user_id), name: String(row.name), kind: String(row.kind), url: row.url ? String(row.url) : undefined,
    format: String(row.format), enabled: readFlag(row.enabled), intervalMinutes: Number(row.interval_minutes || 0), userAgent: row.user_agent ? String(row.user_agent) : undefined,
    skipCertVerify: readFlag(row.skip_cert_verify), lastRequestProfile: row.last_request_profile ? String(row.last_request_profile) : undefined, nodeCount: Number(row.node_count), lastUpdatedAt: row.last_updated_at ? String(row.last_updated_at) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function listManagedNodes(userId: string, sourceId?: string) {
  migrateLegacyProjects(userId);
  const rows = (sourceId ? db.prepare('SELECT * FROM managed_nodes WHERE user_id = ? AND source_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC').all(userId, sourceId) : db.prepare('SELECT * FROM managed_nodes WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC').all(userId)) as Record<string, unknown>[];
  return rows.map(readManagedNode);
}

export function createNodeSource(userId: string, input: NodeSourceInput) {
  const id = randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO node_sources (id,user_id,name,kind,url,format,enabled,interval_minutes,user_agent,skip_cert_verify,node_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(id, userId, input.name, input.kind, input.url || null, input.format || 'auto', input.enabled === false ? 0 : 1, input.intervalMinutes || 0, input.userAgent?.trim() || null, input.skipCertVerify ? 1 : 0, stamp, stamp);
  return listNodeSources(userId).find(item => item.id === id)!;
}

export function updateNodeSource(userId: string, id: string, input: NodeSourceInput) {
  const result = db.prepare("UPDATE node_sources SET name = ?, kind = ?, url = ?, format = ?, enabled = ?, interval_minutes = ?, user_agent = ?, skip_cert_verify = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(input.name, input.kind, input.url || null, input.format || "auto", input.enabled === false ? 0 : 1, input.intervalMinutes || 0, input.userAgent?.trim() || null, input.skipCertVerify ? 1 : 0, now(), id, userId);
  if (!result.changes) return undefined;
  return listNodeSources(userId).find(item => item.id === id);
}

export function markNodeSourceError(userId: string, id: string, message: string) {
  const stamp = now();
  const result = db.prepare("UPDATE node_sources SET last_error = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(message.slice(0, 500), stamp, id, userId);
  return result.changes > 0;
}

export function replaceManagedNodesForSource(userId: string, sourceId: string, incoming: ProxyNode[], requestProfile?: string) {
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
    const index = take(byIdentity.get(managedNodeIdentity(item.node))) ?? take(byName.get(String(item.row.original_name || item.node.name)));
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
    const updateOrder = db.prepare("UPDATE managed_nodes SET sort_order = ? WHERE id = ? AND user_id = ?");
    const update = db.prepare(`UPDATE managed_nodes SET name=?,type=?,server=?,port=?,config_json=?,raw_config_json=?,sort_order=?,updated_at=? WHERE id=? AND user_id=? AND source_id=?`);
    const insert = db.prepare(`INSERT INTO managed_nodes
      (id,user_id,source_id,name,type,server,port,config_json,raw_config_json,enabled,sort_order,tags_json,note,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const retainedSourceIds = new Set<string>();
    const changedSourceIds = new Set<string>();
    desired.forEach((item, position) => {
      if (item.existing && String(item.existing.source_id || "") !== sourceId) {
        updateOrder.run(position, item.id, userId);
        return;
      }
      const previous = item.existing;
      retainedSourceIds.add(item.id);
      const upstreamName = item.node.name;
      if (previous && readFlag(previous.name_override)) item.node = { ...item.node, name: String(previous.name) };
      const serialized = JSON.stringify({ ...item.node, id: item.id });
      if (previous) {
        if (proxyConfigChanged(managedNodeConfig(previous), { ...item.node, id: item.id })) changedSourceIds.add(item.id);
        update.run(item.node.name, item.node.type, item.node.server, item.node.port, serialized, JSON.stringify(item.node.extra || {}), position, stamp, item.id, userId, sourceId);
      }
      else insert.run(item.id, userId, sourceId, item.node.name, item.node.type, item.node.server, item.node.port, serialized, JSON.stringify(item.node.extra || {}), 1, position, "[]", null, stamp, stamp);
      db.prepare("UPDATE managed_nodes SET original_name = ? WHERE id = ?").run(upstreamName, item.id);
    });
    touchProjectsForNodes(userId, [...changedSourceIds]);
    const obsolete = existing.map((item) => String(item.row.id)).filter((id) => !retainedSourceIds.has(id));
    removeProjectNodeReferences(userId, obsolete);
    const remove = db.prepare("DELETE FROM managed_nodes WHERE id = ? AND user_id = ? AND source_id = ?");
    for (const id of obsolete) remove.run(id, userId, sourceId);
    db.prepare("UPDATE node_sources SET last_updated_at = ?, last_error = NULL, last_request_profile = COALESCE(?, last_request_profile), node_count = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(stamp, requestProfile || null, nodes.length, stamp, sourceId, userId);
  })();
  return { source: listNodeSources(userId).find((item) => item.id === sourceId)!, nodes: listManagedNodes(userId, sourceId) };
}

export function createManagedNode(userId: string, input: ManagedNodeInput) {
  const id = input.id || randomUUID(); const stamp = now();
  if (input.sourceId && !db.prepare("SELECT id FROM node_sources WHERE id = ? AND user_id = ?").get(input.sourceId, userId)) throw new Error("节点来源不存在");
  const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM managed_nodes WHERE user_id = ?").get(userId) as { value: number };
  db.prepare(`INSERT INTO managed_nodes (id,user_id,source_id,name,type,server,port,config_json,raw_config_json,enabled,sort_order,tags_json,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, input.sourceId || null, input.name, input.type, input.server, input.port, JSON.stringify(managedInputConfig(input, id)), JSON.stringify(input.extra || {}), input.enabled === false ? 0 : 1, Number(max.value) + 1, JSON.stringify(input.tags || []), input.note || null, stamp, stamp);
  db.prepare("UPDATE managed_nodes SET original_name = ? WHERE id = ?").run(input.name, id);
  if (input.sourceId) db.prepare("UPDATE node_sources SET node_count = (SELECT COUNT(*) FROM managed_nodes WHERE source_id = ?), updated_at = ? WHERE id = ? AND user_id = ?").run(input.sourceId, stamp, input.sourceId, userId);
  return listManagedNodes(userId).find(item => item.id === id)!;
}

export function getManagedNode(userId: string, id: string) {
  const row = db.prepare("SELECT * FROM managed_nodes WHERE id = ? AND user_id = ?").get(id, userId) as Record<string, unknown> | undefined;
  return row ? readManagedNode(row) : undefined;
}

export function updateManagedNode(userId: string, id: string, input: ManagedNodeInput) {
  const existing = db.prepare("SELECT * FROM managed_nodes WHERE id = ? AND user_id = ?").get(id, userId) as Record<string, unknown> | undefined;
  if (!existing) return undefined;
  const stamp = new Date(Math.max(Date.now(), new Date(String(existing.updated_at)).getTime() + 1)).toISOString();
  const previousName = String(existing.name);
  const nextConfig = managedInputConfig(input, id);
  const configChanged = proxyConfigChanged(managedNodeConfig(existing), nextConfig);
  db.transaction(() => {
    if (countryFlagForRename(previousName, input.name) && db.prepare("SELECT id FROM managed_nodes WHERE user_id = ? AND id <> ? AND name = ?").get(userId, id, input.name)) throw new Error(`节点库存在节点名称冲突：${input.name}，请先调整名称`);
    const enabled = input.enabled === undefined ? Number(existing.enabled) : input.enabled ? 1 : 0;
    const unchanged = previousName === input.name && !configChanged && enabled === Number(existing.enabled) && JSON.stringify(input.tags || []) === String(existing.tags_json) && (input.note || null) === existing.note;
    if (!unchanged) db.prepare(`UPDATE managed_nodes SET name = ?, type = ?, server = ?, port = ?, config_json = ?, raw_config_json = ?, enabled = ?, tags_json = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(input.name, input.type, input.server, input.port, JSON.stringify(nextConfig), JSON.stringify(input.extra || {}), input.enabled === undefined ? Number(existing.enabled) : input.enabled ? 1 : 0, JSON.stringify(input.tags || []), input.note || null, stamp, id, userId);
    if (previousName !== input.name) db.prepare("UPDATE managed_nodes SET name_override = 1, original_name = COALESCE(original_name, ?) WHERE id = ? AND user_id = ?").run(previousName, id, userId);
    renameNodeAliases(userId, id, previousName, input.name);
    if (configChanged) touchProjectsForNodes(userId, [id]);
  })();
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

export function batchUpdateManagedNodes(userId: string, ids: string[], input: { enabled?: boolean; addTags?: string[]; removeTags?: string[]; prefix?: string; find?: string; replace?: string }) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) throw new Error("请选择节点");
  const rows = db.prepare(`SELECT * FROM managed_nodes WHERE user_id = ? AND id IN (${uniqueIds.map(() => "?").join(",")})`).all(userId, ...uniqueIds) as Record<string, unknown>[];
  if (rows.length !== uniqueIds.length) throw new Error("批量操作包含无权使用的节点");
  const addTags = [...new Set(input.addTags || [])];
  const removeTags = new Set(input.removeTags || []);
  const stamp = now();
  db.transaction(() => {
    const update = db.prepare("UPDATE managed_nodes SET name=?,config_json=?,enabled=?,tags_json=?,updated_at=? WHERE id=? AND user_id=?");
    for (const row of rows) {
      const node = managedNodeConfig(row);
      let name = `${input.prefix || ""}${node.name}`;
      if (input.find) name = name.split(input.find).join(input.replace || "");
      name = name.trim().slice(0, 160) || node.name;
      const tags = [...new Set([...readJson<string[]>(row.tags_json, []).filter((tag) => !removeTags.has(tag)), ...addTags])].slice(0, 30);
      const enabled = input.enabled === undefined ? Number(row.enabled) : input.enabled ? 1 : 0;
      update.run(name, JSON.stringify({ ...node, name }), enabled, JSON.stringify(tags), stamp, row.id, userId);
      if (node.name !== name) db.prepare("UPDATE managed_nodes SET name_override = 1, original_name = COALESCE(original_name, ?) WHERE id = ? AND user_id = ?").run(node.name, row.id, userId);
      renameNodeAliases(userId, String(row.id), node.name, name);
    }
  })();
  return listManagedNodes(userId);
}

export function deleteManagedNode(userId: string, id: string) {
  const existing = db.prepare("SELECT source_id FROM managed_nodes WHERE id = ? AND user_id = ?").get(id, userId) as { source_id?: string } | undefined;
  if (!existing) return false;
  db.transaction(() => {
    removeProjectNodeReferences(userId, [id]);
    db.prepare("DELETE FROM managed_nodes WHERE id = ? AND user_id = ?").run(id, userId);
    normalizeManagedNodeOrder(userId);
    if (existing.source_id) db.prepare("UPDATE node_sources SET node_count = (SELECT COUNT(*) FROM managed_nodes WHERE source_id = ?), updated_at = ? WHERE id = ? AND user_id = ?").run(existing.source_id, now(), existing.source_id, userId);
  })();
  return true;
}

function validateProfileInput(userId: string, input: { targetFormat: TargetFormat; config: MihomoConfig; nodeIds?: string[]; sourceIds?: string[]; templateId?: string }) {
  const parsedConfig = readMihomoConfig(input.config);
  if (!parsedConfig.success) throw new Error("生成配置格式无效");
  if (previewExport(input.config, input.targetFormat).issues.some((issue) => issue.level === "error")) throw new Error("生成配置存在错误，请先修复配置");
  const nodeIds = [...new Set(input.nodeIds || [])];
  const sourceIds = [...new Set(input.sourceIds || [])];
  if (nodeIds.length > 5000 || sourceIds.length > 500) throw new Error("生成配置引用数量超过限制");
  const configIds = new Set(input.config.proxies.map((node) => node.id));
  const referencedNodeIds = [...new Set([...nodeIds, ...configIds])];
  const managedRows = referencedNodeIds.length ? db.prepare(`SELECT id, user_id FROM managed_nodes WHERE id IN (${referencedNodeIds.map(() => "?").join(",")})`).all(...referencedNodeIds) as { id: string; user_id: string }[] : [];
  if (managedRows.some((row) => row.user_id !== userId)) throw new Error("生成配置包含无权使用的节点");
  const managedIds = new Set(managedRows.map((row) => row.id));
  if (nodeIds.some((id) => !managedIds.has(id) && !configIds.has(id))) throw new Error("生成配置包含无权使用的节点");
  if (sourceIds.length && Number((db.prepare(`SELECT COUNT(*) AS count FROM node_sources WHERE user_id = ? AND id IN (${sourceIds.map(() => "?").join(",")})`).get(userId, ...sourceIds) as { count: number }).count) !== sourceIds.length) throw new Error("生成配置包含无权使用的节点来源");
  if (input.templateId && !db.prepare("SELECT id FROM rule_templates WHERE id = ? AND (is_builtin = 1 OR user_id = ?)").get(input.templateId, userId)) throw new Error("规则模板不存在或无权使用");
  return { nodeIds, sourceIds };
}

export function createProfile(userId: string, input: { name: string; targetFormat: TargetFormat; config: MihomoConfig; nodeIds?: string[]; sourceIds?: string[]; templateId?: string }) {
  const { nodeIds, sourceIds } = validateProfileInput(userId, input);
  const id = randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO generation_profiles (id,user_id,name,target_format,config_json,node_ids_json,source_ids_json,template_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, input.name, input.targetFormat, JSON.stringify(input.config), JSON.stringify(nodeIds), JSON.stringify(sourceIds), input.templateId || null, 'active', stamp, stamp);
  return getProfile(userId, id);
}

export function getProfile(userId: string, id: string) {
  const row = db.prepare('SELECT * FROM generation_profiles WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return { projectId: row.project_id ? String(row.project_id) : undefined, autoUpdate: readFlag(row.auto_update), includeNewNodes: readFlag(row.include_new_nodes), lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : undefined, lastSyncError: row.last_sync_error ? String(row.last_sync_error) : undefined, id: String(row.id), userId: String(row.user_id), name: String(row.name), targetFormat: String(row.target_format) as TargetFormat, config: readJson<MihomoConfig>(row.config_json, {} as MihomoConfig), nodeIds: readJson<string[]>(row.node_ids_json, []), sourceIds: readJson<string[]>(row.source_ids_json, []), templateId: row.template_id ? String(row.template_id) : undefined, status: String(row.status), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function listProfiles(userId: string) { return (db.prepare('SELECT id FROM generation_profiles WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as { id: string }[]).map(item => getProfile(userId, item.id)!); }

export function updateProfile(userId: string, id: string, input: { name: string; targetFormat: TargetFormat; config: MihomoConfig; nodeIds?: string[]; sourceIds?: string[]; templateId?: string }) {
  const existing = getProfile(userId, id);
  if (!existing) return undefined;
  const { nodeIds, sourceIds } = validateProfileInput(userId, input);
  db.prepare("UPDATE generation_profiles SET name=?,target_format=?,config_json=?,node_ids_json=?,source_ids_json=?,template_id=?,updated_at=? WHERE id=? AND user_id=?")
    .run(input.name, input.targetFormat, JSON.stringify(input.config), JSON.stringify(nodeIds), JSON.stringify(sourceIds), input.templateId || null, new Date(Math.max(Date.now(), new Date(existing.updatedAt).getTime() + 1)).toISOString(), id, userId);
  return getProfile(userId, id);
}

export function deleteProfile(userId: string, id: string) {
  return db.prepare("DELETE FROM generation_profiles WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function publishSubscription(userId: string, profileId: string, name: string, targetFormat: TargetFormat, content: string, nodeCount: number, expiresAt?: string) {
  const profile = getProfile(userId, profileId); if (!profile) throw new Error('生成配置不存在');
  if (profile.targetFormat !== targetFormat) throw new Error('发布格式与生成配置不一致');
  if (!content.trim() || content.length > 10_000_000) throw new Error('发布内容无效或超过 10MB');
  if (!Number.isInteger(nodeCount) || nodeCount < 0 || nodeCount > profile.config.proxies.length) throw new Error('节点数量无效');
  if (expiresAt && !Number.isFinite(new Date(expiresAt).getTime())) throw new Error('过期时间无效');
  const id = randomUUID(); const token = randomBytes(32).toString('base64url'); const stamp = now();
  const tokenCipher = sealToken(token, id);
  const previous = db.prepare('SELECT MAX(version) AS version FROM generated_subscriptions WHERE profile_id = ?').get(profileId) as { version?: number };
  db.prepare(`INSERT INTO generated_subscriptions (id,profile_id,user_id,name,target_format,token_hash,content,version,node_count,expires_at,revoked,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(id, profileId, userId, name, targetFormat, hashToken(token), content, Number(previous?.version || 0) + 1, nodeCount, expiresAt || null, stamp, stamp);
  db.prepare("UPDATE generated_subscriptions SET token_cipher = ? WHERE id = ?").run(tokenCipher, id);
  return { id, profileId, name, targetFormat, token, version: Number(previous?.version || 0) + 1, nodeCount, expiresAt, revoked: false, createdAt: stamp, updatedAt: stamp };
}

export function listPublishedSubscriptions(userId: string) {
  return (db.prepare('SELECT * FROM generated_subscriptions WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Record<string, unknown>[]).map(row => ({ id: String(row.id), profileId: String(row.profile_id), name: String(row.name), targetFormat: String(row.target_format), version: Number(row.version), nodeCount: Number(row.node_count), expiresAt: row.expires_at ? String(row.expires_at) : undefined, revoked: Boolean(row.revoked), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export function updatePublishedSubscription(userId: string, id: string, input: { name: string; content: string; nodeCount: number; expiresAt?: string }) {
  const row = db.prepare("SELECT * FROM generated_subscriptions WHERE id = ? AND user_id = ? AND revoked = 0").get(id, userId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const profile = getProfile(userId, String(row.profile_id));
  if (!profile) throw new Error("生成方案不存在");
  if (String(row.target_format) !== profile.targetFormat) throw new Error("输出格式已改变，请创建新的订阅链接");
  if (!input.content.trim() || input.content.length > 10_000_000) throw new Error("发布内容无效或超过 10MB");
  if (!Number.isInteger(input.nodeCount) || input.nodeCount < 0 || input.nodeCount > profile.config.proxies.length) throw new Error("节点数量无效");
  if (input.expiresAt && !Number.isFinite(new Date(input.expiresAt).getTime())) throw new Error("过期时间无效");
  const stamp = now();
  db.prepare("UPDATE generated_subscriptions SET name=?,content=?,version=version+1,node_count=?,expires_at=?,updated_at=? WHERE id=? AND user_id=?")
    .run(input.name, input.content, input.nodeCount, input.expiresAt || null, stamp, id, userId);
  return listPublishedSubscriptions(userId).find((item) => item.id === id);
}

export function deletePublishedSubscription(userId: string, id: string) {
  return db.prepare("DELETE FROM generated_subscriptions WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
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
  const result = db.prepare("UPDATE generated_subscriptions SET token_hash = ?, token_cipher = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revoked = 0").run(hashToken(token), sealToken(token, id), now(), id, userId);
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

export function deleteNodeSource(userId: string, id: string) {
  return db.prepare("DELETE FROM node_sources WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

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
