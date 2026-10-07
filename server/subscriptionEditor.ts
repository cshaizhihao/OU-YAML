import { createHash } from "node:crypto";
import { db } from "./db";
import { createProfile, getProfile, listManagedNodes, listPublishedSubscriptions, updateProfile, updatePublishedSubscription } from "./domainService";
import { validatedContent } from "./publicationService";
import type { SubscriptionEditInput, SubscriptionEditorState } from "../src/shared/subscriptionEditor";
import { refreshProfileConfig } from "../src/shared/publication";

function readEditor(userId: string, id: string) {
  const subscription = listPublishedSubscriptions(userId).find((item) => item.id === id);
  const profile = subscription && getProfile(userId, subscription.profileId);
  if (!subscription || !profile) throw new Error("订阅或生成方案不存在，无法编辑");
  if (subscription.revoked) throw new Error("订阅已撤销，不能更新；请重新发布");
  if (subscription.targetFormat !== profile.targetFormat) throw new Error("订阅与方案格式不一致，请在高级发布中处理");
  const managed = listManagedNodes(userId);
  const related = listPublishedSubscriptions(userId).filter((item) => item.profileId === profile.id);
  const revision = createHash("sha256").update(JSON.stringify({ subscription, related, profile: { ...profile, lastSyncAt: undefined, lastSyncError: undefined }, managed })).digest("hex");
  return { subscription, profile, managed, related, revision };
}

export function getSubscriptionEditor(userId: string, id: string): SubscriptionEditorState {
  const { subscription, profile, managed, revision } = readEditor(userId, id);
  const disabled = new Set(managed.filter((node) => !node.enabled).map((node) => node.id));
  const config = refreshProfileConfig(profile.config, profile.config.proxies.filter((node) => !disabled.has(node.id)), false);
  return { subscription: subscription as SubscriptionEditorState["subscription"], config, revision };
}

export function renameSubscription(userId: string, id: string, name: string) {
  const current = listPublishedSubscriptions(userId).find((item) => item.id === id);
  if (!current) throw new Error("订阅不存在");
  db.prepare("UPDATE generated_subscriptions SET name = ? WHERE id = ? AND user_id = ?").run(name, id, userId);
  return listPublishedSubscriptions(userId).find((item) => item.id === id)!;
}

const editing = new Set<string>();
export async function saveSubscriptionEditor(userId: string, id: string, input: SubscriptionEditInput) {
  if (editing.has(id)) throw new Error("此订阅正在更新，请稍候");
  editing.add(id);
  try {
    const before = readEditor(userId, id);
    if (input.revision !== before.revision) throw new Error("订阅或节点已经变化，请重新载入后编辑；旧内容未被修改");
    const { content, kernelChecked } = await validatedContent(input.config, before.subscription.targetFormat as "mihomo" | "sing-box");
    return db.transaction(() => {
      if (readEditor(userId, id).revision !== before.revision) throw new Error("校验期间订阅或节点已变化，请重新载入；旧内容未被修改");
      const nodeIds = input.config.proxies.map((node) => node.id);
      const nodeSet = new Set(nodeIds);
      const sourceIds = [...new Set(before.managed.filter((node) => nodeSet.has(node.id) && node.sourceId).map((node) => node.sourceId!))];
      const payload = { name: before.profile.name, targetFormat: before.profile.targetFormat, config: input.config, nodeIds, sourceIds, templateId: before.profile.templateId };
      const profile = before.related.length > 1 ? createProfile(userId, payload)! : updateProfile(userId, before.profile.id, payload)!;
      if (profile.id !== before.profile.id) {
        db.prepare("UPDATE generation_profiles SET project_id = ?, auto_update = ?, include_new_nodes = ?, status = ? WHERE id = ?").run(before.profile.projectId || null, Number(before.profile.autoUpdate), Number(before.profile.includeNewNodes), before.profile.status, profile.id);
        db.prepare("UPDATE generated_subscriptions SET profile_id = ? WHERE id = ? AND user_id = ?").run(profile.id, id, userId);
      }
      const previousContent = (db.prepare("SELECT content FROM generated_subscriptions WHERE id = ? AND user_id = ?").get(id, userId) as { content: string }).content;
      if (previousContent === content) renameSubscription(userId, id, input.name);
      else updatePublishedSubscription(userId, id, { name: input.name, content, nodeCount: input.config.proxies.length, expiresAt: before.subscription.expiresAt });
      db.prepare("UPDATE generation_profiles SET last_sync_at = ?, last_sync_error = NULL WHERE id = ?").run(new Date().toISOString(), profile.id);
      return { ...getSubscriptionEditor(userId, id), kernelChecked };
    })();
  } finally { editing.delete(id); }
}
