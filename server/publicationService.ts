import { db, snapshotProject } from "./db";
import { createProfile, getProfile, hydrateProject, listManagedNodes, listPublishedSubscriptions, publishSubscription, syncProjectNodes, updateProfile, updatePublishedSubscription } from "./domainService";
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

export async function quickPublish(userId: string, projectId: string, input: { nodeIds: string[]; preset: "balanced" | "simple" | "current"; autoUpdate: boolean; includeNewNodes: boolean; updatedAt: string }) {
  if (activeProjects.has(projectId)) throw new Error("当前项目正在发布，请稍候");
  activeProjects.add(projectId);
  try {
    const row = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("项目不存在");
    if (row.updated_at !== input.updatedAt) throw new Error("项目已发生变化，请刷新后重新发布");
    const project = hydrateProject(row);
    const nodeRevision = JSON.stringify(listManagedNodes(userId));
    const nodes = configNodes(userId, input.nodeIds);
    if (nodes.length !== new Set(input.nodeIds).size) throw new Error("所选节点已停用、删除或无权使用");
    const config = input.preset === "current" ? refreshProfileConfig(project.config, nodes, true) : recommendedConfig(nodes, input.preset);
    const { content, kernelChecked } = await validatedContent(config, project.targetFormat);
    const sourceIds = [...new Set(listManagedNodes(userId).filter((node) => input.nodeIds.includes(node.id) && node.sourceId).map((node) => node.sourceId!))];
    return db.transaction(() => {
      const current = db.prepare("SELECT updated_at FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as { updated_at: string } | undefined;
      if (JSON.stringify(listManagedNodes(userId)) !== nodeRevision) throw new Error("校验期间节点发生变化，请重试");
      if (current?.updated_at !== input.updatedAt) throw new Error("校验期间项目发生变化，请重试");
      snapshotProject(projectId, userId, "快捷发布前", true);
      config.proxies = syncProjectNodes(userId, projectId, config.proxies);
      const stamp = new Date(Math.max(Date.now(), new Date(input.updatedAt).getTime() + 1)).toISOString();
      db.prepare("UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(config), stamp, projectId, userId);
      const existing = db.prepare("SELECT id FROM generation_profiles WHERE project_id = ? AND user_id = ? ORDER BY created_at LIMIT 1").get(projectId, userId) as { id: string } | undefined;
      const payload = { name: `${project.name} · 快捷方案`, targetFormat: project.targetFormat, config, nodeIds: config.proxies.map((node) => node.id), sourceIds };
      const profile = existing ? updateProfile(userId, existing.id, payload)! : createProfile(userId, payload)!;
      db.prepare("UPDATE generation_profiles SET project_id = ?, auto_update = ?, include_new_nodes = ?, last_sync_at = ?, last_sync_error = NULL WHERE id = ?").run(projectId, Number(input.autoUpdate), Number(input.includeNewNodes), stamp, profile.id);
      const publication = listPublishedSubscriptions(userId).find((item) => item.profileId === profile.id && !item.revoked && item.targetFormat === project.targetFormat && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()));
      if (publication) {
        const updated = updatePublishedSubscription(userId, publication.id, { name: publication.name, content, nodeCount: config.proxies.length, expiresAt: publication.expiresAt })!;
        let token: string | undefined;
        try { token = readSubscriptionToken(userId, publication.id); } catch { token = undefined; }
        return { ...updated, token, kernelChecked };
      }
      return { ...publishSubscription(userId, profile.id, `${project.name} · 订阅`, project.targetFormat, content, config.proxies.length), kernelChecked };
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
        const latest = db.prepare("SELECT version, revoked FROM generated_subscriptions WHERE id = ?").get(publication.id) as { version: number; revoked: number } | undefined;
        if (!latest || latest.revoked || latest.version !== publication.version) throw new Error("订阅在校验期间发生变化，请重试");
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
