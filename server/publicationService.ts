import { createHash } from "node:crypto";
import { parseImportedContent } from "./importer";
import type { QuickPublishInput, QuickPublishPreview } from "../src/shared/publication";
import { db, snapshotProject } from "./db";
import { createProfile, getProfile, readProjectNodes, listManagedNodes, listPublishedSubscriptions, publishSubscription, syncProjectNodes, updateProfile, updatePublishedSubscription } from "./domainService";
import { previewExport } from "../src/shared/exportConfig";
import { recommendedConfig, refreshProfileConfig } from "../src/shared/publication";
import { validateWithKernel } from "./kernelValidator";
import { openToken } from "./tokenVault";
import type { MihomoConfig, ProxyNode, TargetFormat } from "../src/shared/types";

const activeProfiles = new Set<string>();
const activeProjects = new Set<string>();

function configNodes(userId: string, ids?: string[]) {
  return listManagedNodes(userId).filter((node) => node.enabled && (!ids || ids.includes(node.id))).map((node) => {
    const { userId: _userId, sourceId: _sourceId, enabled: _enabled, sortOrder: _sortOrder, tags: _tags, note: _note, createdAt: _createdAt, updatedAt: _updatedAt, ...config } = node;
    return config as ProxyNode;
  });
}

export async function validatedContent(config: MihomoConfig, format: TargetFormat) {
  if (!config.proxies.length) throw new Error("没有可用节点，保留上一次发布内容");
  const { content, issues } = previewExport(config, format);
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length) throw new Error(errors.map((issue) => issue.message).join("；"));
  const kernel = await validateWithKernel(config, format);
  if (kernel.available && !kernel.valid) throw new Error("内核校验失败，请到预览校验查看具体问题；原订阅保持不变");
  return { content, kernelChecked: kernel.available };
}

export function readSubscriptionToken(userId: string, id: string) {
  const row = db.prepare("SELECT token_cipher FROM generated_subscriptions WHERE id = ? AND user_id = ? AND revoked = 0").get(id, userId) as { token_cipher?: string } | undefined;
  if (!row) throw new Error("订阅不存在");
  if (!row.token_cipher) throw new Error("旧版订阅没有保存可恢复地址，请继续使用已复制的链接，或手动重置一次");
  return openToken(row.token_cipher, id);
}

export function configureProfileSync(userId: string, id: string, autoUpdate: boolean, includeNewNodes: boolean) {
  const profile = getProfile(userId, id);
  if (!profile) throw new Error("生成方案不存在");
  db.prepare("UPDATE generation_profiles SET auto_update = ?, include_new_nodes = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(Number(autoUpdate), Number(includeNewNodes), new Date(Math.max(Date.now(), new Date(profile.updatedAt).getTime() + 1)).toISOString(), id, userId);
  return getProfile(userId, id)!;
}

function prepareQuickPublish(userId: string, projectId: string, input: QuickPublishInput) {
  const row = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("项目不存在");
  if (row.updated_at !== input.updatedAt) throw new Error("项目已发生变化，请刷新后重新检查");
  const stored = JSON.parse(String(row.config_json)) as MihomoConfig;
  const boundNodes = readProjectNodes(userId, projectId);
  const project = { id: projectId, name: String(row.name), updatedAt: String(row.updated_at), targetFormat: row.target_format as TargetFormat, config: { ...stored, proxies: boundNodes.length ? boundNodes : stored.proxies } };
  const managed = listManagedNodes(userId);
  const nodes = configNodes(userId, input.nodeIds);
  if (nodes.length !== new Set(input.nodeIds).size) throw new Error("所选节点已停用、删除或无权使用");
  const projectNodes = new Map(project.config.proxies.map((node) => [node.id, node]));
  const config = input.preset === "current"
    ? refreshProfileConfig(project.config, nodes.map((node) => projectNodes.get(node.id) || node), true)
    : recommendedConfig(nodes, input.preset);
  const existing = db.prepare("SELECT * FROM generation_profiles WHERE project_id = ? AND user_id = ? AND target_format = ? ORDER BY created_at, id LIMIT 1").get(projectId, userId, project.targetFormat) as Record<string, unknown> | undefined;
  const publications = existing ? db.prepare("SELECT * FROM generated_subscriptions WHERE profile_id = ? AND user_id = ? ORDER BY updated_at DESC, id").all(existing.id, userId) as Record<string, unknown>[] : [];
  const publication = publications.find((item) => !item.revoked && item.target_format === project.targetFormat && (!item.expires_at || new Date(String(item.expires_at)).getTime() > Date.now()));
  const profileRevision = existing ? { ...existing, last_sync_at: undefined, last_sync_error: undefined } : undefined;
  const revision = createHash("sha256").update(JSON.stringify({ row, project, managed, existing: profileRevision, publications, name: input.name, preset: input.preset, nodeIds: [...input.nodeIds].sort(), publicationId: publication?.id, autoUpdate: input.autoUpdate, includeNewNodes: input.includeNewNodes })).digest("hex");
  return { project, config, existing, publication, revision, sourceIds: [...new Set(managed.filter((node) => input.nodeIds.includes(node.id) && node.sourceId).map((node) => node.sourceId!))] };
}

export function previewQuickPublish(userId: string, projectId: string, input: QuickPublishInput): QuickPublishPreview {
  const { config, project, publication, revision } = prepareQuickPublish(userId, projectId, input);
  const { content, issues } = previewExport(config, project.targetFormat);
  const errors = issues.filter((issue) => issue.level === "error");
  if (!config.proxies.length || errors.length) throw new Error(errors.map((issue) => issue.message).join("；") || "没有可用节点");
  let before: QuickPublishPreview["before"] = null;
  if (publication) {
    const parsed = parseImportedContent(String(publication.content), project.targetFormat);
    before = { nodes: Number(publication.node_count), groups: parsed.config?.proxyGroups.length || 0, rules: parsed.config?.rules.length || 0 };
  }
  return {
    revision, before,
    after: { nodes: config.proxies.length, groups: config.proxyGroups.length, rules: config.rules.length },
    existingName: publication ? String(publication.name) : undefined,
    existingVersion: publication ? Number(publication.version) : undefined,
    createsNewLink: !publication,
    contentChanged: !publication || publication.content !== content,
  };
}

export async function quickPublish(userId: string, projectId: string, input: QuickPublishInput) {
  if (activeProjects.has(projectId)) throw new Error("当前项目正在发布，请稍候");
  activeProjects.add(projectId);
  try {
    const prepared = prepareQuickPublish(userId, projectId, input);
    const { project, config, existing, publication, sourceIds } = prepared;
    if (input.previewRevision && input.previewRevision !== prepared.revision) throw new Error("预览后数据发生变化，请重新检查再发布；原订阅未被修改");
    const { content, kernelChecked } = await validatedContent(config, project.targetFormat);
    return db.transaction(() => {
      if (prepareQuickPublish(userId, projectId, input).revision !== prepared.revision) throw new Error("校验期间数据发生变化，请重新检查再发布；原订阅未被修改");
      snapshotProject(projectId, userId, "快捷发布前", true);
      config.proxies = syncProjectNodes(userId, projectId, config.proxies);
      const stamp = new Date(Math.max(Date.now(), new Date(input.updatedAt).getTime() + 1)).toISOString();
      db.prepare("UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(config), stamp, projectId, userId);
      const payload = { name: existing ? String(existing.name) : `${project.name} · 快捷方案`, targetFormat: project.targetFormat, config, nodeIds: config.proxies.map((node) => node.id), sourceIds };
      const profile = existing ? updateProfile(userId, String(existing.id), payload)! : createProfile(userId, payload)!;
      db.prepare("UPDATE generation_profiles SET project_id = ?, auto_update = ?, include_new_nodes = ?, last_sync_at = ?, last_sync_error = NULL WHERE id = ?").run(projectId, Number(input.autoUpdate), Number(input.includeNewNodes), stamp, profile.id);
      if (publication) {
        if (input.name) db.prepare("UPDATE generated_subscriptions SET name = ? WHERE id = ? AND user_id = ?").run(input.name, publication.id, userId);
        const updated = publication.content === content
          ? listPublishedSubscriptions(userId).find((item) => item.id === publication.id)!
          : updatePublishedSubscription(userId, String(publication.id), { name: input.name || String(publication.name), content, nodeCount: config.proxies.length, expiresAt: publication.expires_at ? String(publication.expires_at) : undefined })!;
        let token: string | undefined;
        try { token = readSubscriptionToken(userId, String(publication.id)); } catch { token = undefined; }
        return { ...updated, token, kernelChecked };
      }
      return { ...publishSubscription(userId, profile.id, input.name || `${project.name} · 订阅`, project.targetFormat, content, config.proxies.length), kernelChecked };
    })();
  } finally { activeProjects.delete(projectId); }
}
export async function syncProfile(userId: string, profileId: string) {
  if (activeProfiles.has(profileId)) throw new Error("方案正在同步，请稍后重试");
  activeProfiles.add(profileId);
  try {
    const profile = getProfile(userId, profileId);
    if (!profile) throw new Error("生成方案不存在");
    const nodeRevision = JSON.stringify(listManagedNodes(userId));
    const ids = listManagedNodes(userId).filter((node) => profile.nodeIds.includes(node.id) || (profile.includeNewNodes && node.sourceId && profile.sourceIds.includes(node.sourceId))).map((node) => node.id);
    const selectedNodes = configNodes(userId, ids);
    const templateNodes = [...profile.config.proxies.filter((node) => !selectedNodes.some((current) => current.id === node.id)), ...selectedNodes];
    const template = refreshProfileConfig(profile.config, templateNodes, Boolean(profile.includeNewNodes));
    const config = refreshProfileConfig(template, selectedNodes, false);
    const initial = previewExport(config, profile.targetFormat);
    const publications = listPublishedSubscriptions(userId).filter((item) => item.profileId === profileId && !item.revoked && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()));
    if (!publications.length) return;
    const unchanged = initial.content && publications.every((item) => (db.prepare("SELECT content FROM generated_subscriptions WHERE id = ?").get(item.id) as { content: string }).content === initial.content);
    const content = unchanged ? initial.content : (await validatedContent(config, profile.targetFormat)).content;
    db.transaction(() => {
      const current = getProfile(userId, profileId);
      if (JSON.stringify(listManagedNodes(userId)) !== nodeRevision) throw new Error("节点在校验期间发生变化，将在下一次同步重试");
      for (const publication of publications) {
        const latest = db.prepare("SELECT version, revoked, profile_id FROM generated_subscriptions WHERE id = ?").get(publication.id) as { version: number; revoked: number; profile_id: string } | undefined;
        if (!latest || latest.revoked || latest.version !== publication.version || latest.profile_id !== profileId) throw new Error("订阅在校验期间发生变化，请重试");
      }
      if (!current || current.updatedAt !== profile.updatedAt) throw new Error("方案在校验期间发生变化，将在下一次同步重试");
      db.prepare("UPDATE generation_profiles SET config_json = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(template), profileId, userId);
      for (const publication of publications) {
        if (publication.targetFormat !== profile.targetFormat) throw new Error("发布格式与方案不一致，请手动重新发布");
        const latest = db.prepare("SELECT content FROM generated_subscriptions WHERE id = ? AND revoked = 0").get(publication.id) as { content: string } | undefined;
        if (latest && latest.content !== content) updatePublishedSubscription(userId, publication.id, { name: publication.name, content, nodeCount: config.proxies.length, expiresAt: publication.expiresAt });
      }
      const stamp = new Date(Math.max(Date.now(), new Date(profile.updatedAt).getTime() + 1)).toISOString();
      const updatedAt = JSON.stringify(template) === JSON.stringify(profile.config) ? profile.updatedAt : stamp;
      db.prepare("UPDATE generation_profiles SET config_json = ?, node_ids_json = ?, last_sync_at = ?, updated_at = ?, last_sync_error = NULL WHERE id = ? AND user_id = ?").run(JSON.stringify(template), JSON.stringify([...new Set([...profile.nodeIds, ...template.proxies.map((node) => node.id)])]), stamp, updatedAt, profileId, userId);
    })();
  } catch (error) {
    db.prepare("UPDATE generation_profiles SET last_sync_error = ? WHERE id = ? AND user_id = ?").run((error as Error).message.slice(0, 1000), profileId, userId);
    throw error;
  } finally { activeProfiles.delete(profileId); }
}

let sweepRunning = false;
export async function syncAutoProfiles() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const profiles = db.prepare("SELECT id, user_id FROM generation_profiles WHERE auto_update = 1 AND status = 'active'").all() as { id: string; user_id: string }[];
    for (const profile of profiles) await syncProfile(profile.user_id, profile.id).catch(() => undefined);
  } finally { sweepRunning = false; }
}
