import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEmptyConfig } from "../src/shared/types";
import type { QuickPublishInput } from "../src/shared/publication";

const directory = mkdtempSync(path.join(os.tmpdir(), "ou-publication-workflow-"));
process.env.DATA_DIR = directory;
const { db } = await import("../server/db");
const domain = await import("../server/domainService");
const publication = await import("../server/publicationService");
const editor = await import("../server/subscriptionEditor");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const userId = randomUUID();
  const projectId = randomUUID();
  const stamp = new Date().toISOString();
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(userId, userId, "hash", stamp);
  db.prepare("INSERT INTO projects (id, user_id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(projectId, userId, "流程测试", JSON.stringify(createEmptyConfig()), stamp, stamp);
  const node = domain.createManagedNode(userId, { name: "节点", type: "ss", server: "1.1.1.1", port: 443, cipher: "aes-128-gcm", password: "private-node-password", extra: {} });
  const input: QuickPublishInput = { nodeIds: [node.id], preset: "simple", autoUpdate: false, includeNewNodes: false, updatedAt: stamp };
  const currentInput = (): QuickPublishInput => ({ ...input, preset: "current", updatedAt: (db.prepare("SELECT updated_at FROM projects WHERE id = ?").get(projectId) as { updated_at: string }).updated_at });
  return { userId, projectId, node, input, currentInput };
}

test("发布检查只读、摘要不泄露节点凭据、相同输入的预览标识稳定", async () => {
  const { userId, projectId, input } = fixture();
  const before = db.prepare("SELECT total_changes() AS count").get();
  const preview = publication.previewQuickPublish(userId, projectId, input);
  assert.deepEqual(db.prepare("SELECT total_changes() AS count").get(), before);
  assert.equal(preview.createsNewLink, true);
  assert.deepEqual(preview.after, { nodes: 1, groups: 1, rules: 1 });
  assert.equal(preview.revision, publication.previewQuickPublish(userId, projectId, input).revision);
  assert.doesNotMatch(JSON.stringify(preview), /private-node-password|1\.1\.1\.1/);
  assert.throws(() => publication.previewQuickPublish("other", projectId, input), /不存在/);
  const result = await publication.quickPublish(userId, projectId, { ...input, previewRevision: preview.revision });
  assert.ok(result.token);
});

test("预览后节点、同步选项或公开地址状态变化会拒绝发布", async () => {
  const { userId, projectId, node, input, currentInput } = fixture();
  const first = await publication.quickPublish(userId, projectId, input);
  const checkInput = currentInput();
  const preview = publication.previewQuickPublish(userId, projectId, checkInput);
  const before = domain.readPublicSubscription(first.token!)!;
  domain.updateManagedNode(userId, node.id, { ...node, port: 8443 });
  await assert.rejects(publication.quickPublish(userId, projectId, { ...checkInput, previewRevision: preview.revision }), /发生变化/);
  assert.deepEqual(domain.readPublicSubscription(first.token!), before);
  checkInput.updatedAt = currentInput().updatedAt;
  const next = publication.previewQuickPublish(userId, projectId, checkInput);
  await assert.rejects(publication.quickPublish(userId, projectId, { ...checkInput, autoUpdate: true, previewRevision: next.revision }), /预览后数据发生变化/);
  domain.revokePublishedSubscription(userId, first.id);
  await assert.rejects(publication.quickPublish(userId, projectId, { ...checkInput, previewRevision: next.revision }), /预览后数据发生变化/);
  assert.equal(domain.listPublishedSubscriptions(userId).length, 1);
});

test("保留当前配置保留节点覆盖参数和规则，重复发布不抬高内容版本", async () => {
  const { userId, projectId, node, input, currentInput } = fixture();
  const first = await publication.quickPublish(userId, projectId, input);
  const project = domain.hydrateProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Record<string, unknown>);
  project.config.proxies = domain.syncProjectNodes(userId, projectId, [{ ...node, port: 9443 }]);
  project.config.rules.unshift({ id: randomUUID(), type: "DOMAIN-SUFFIX", value: "example.com", target: "DIRECT", enabled: true, options: [] });
  db.prepare("UPDATE projects SET config_json = ? WHERE id = ?").run(JSON.stringify(project.config), projectId);
  const draft = currentInput();
  const preview = publication.previewQuickPublish(userId, projectId, draft);
  assert.equal(preview.before?.rules, 1);
  assert.equal(preview.after.rules, 2);
  const next = await publication.quickPublish(userId, projectId, { ...draft, previewRevision: preview.revision });
  assert.equal(next.token, first.token);
  assert.equal(next.version, first.version + 1);
  assert.match(domain.readPublicSubscription(next.token!)!.content, /9443/);
  assert.match(domain.readPublicSubscription(next.token!)!.content, /DOMAIN-SUFFIX,example.com,DIRECT/);
  const unchangedPreview = publication.previewQuickPublish(userId, projectId, currentInput());
  assert.equal(unchangedPreview.contentChanged, false);
  const unchanged = await publication.quickPublish(userId, projectId, { ...currentInput(), previewRevision: unchangedPreview.revision });
  assert.equal(unchanged.version, next.version);
  assert.equal(unchanged.updatedAt, next.updatedAt);
});

test("校验期间方案被修改时不覆盖，也不改变上次公开内容", async () => {
  const { userId, projectId, input, currentInput } = fixture();
  const first = await publication.quickPublish(userId, projectId, input);
  const binary = path.join(directory, "slow-kernel");
  writeFileSync(binary, "#!/bin/sh\nsleep 0.2\nexit 0\n", { mode: 0o700 });
  process.env.MIHOMO_BINARY = binary;
  try {
    const pending = publication.quickPublish(userId, projectId, currentInput());
    const rejection = assert.rejects(pending, /校验期间数据发生变化/);
    publication.configureProfileSync(userId, first.profileId, true, true);
    await rejection;
    assert.equal(domain.getProfile(userId, first.profileId)?.autoUpdate, true);
    assert.equal(domain.readPublicSubscription(first.token!)!.version, first.version);
  } finally { delete process.env.MIHOMO_BINARY; }
});

test("改变输出格式创建独立方案，不破坏原格式链接与自动同步", async () => {
  const { userId, projectId, input, currentInput } = fixture();
  const first = await publication.quickPublish(userId, projectId, input);
  db.prepare("UPDATE projects SET target_format = 'sing-box' WHERE id = ?").run(projectId);
  const nextInput = { ...currentInput(), preset: "simple" as const };
  assert.equal(publication.previewQuickPublish(userId, projectId, nextInput).createsNewLink, true);
  const next = await publication.quickPublish(userId, projectId, nextInput);
  assert.notEqual(next.profileId, first.profileId);
  assert.equal(domain.getProfile(userId, first.profileId)?.targetFormat, "mihomo");
  assert.equal(domain.readPublicSubscription(first.token!)?.targetFormat, "mihomo");
  assert.equal(domain.readPublicSubscription(next.token!)?.targetFormat, "sing-box");
});

test("订阅独立重命名不更换地址、不重新发布、不影响内容版本和有效期", async () => {
  const { userId, projectId, input } = fixture();
  const first = await publication.quickPublish(userId, projectId, { ...input, name: "我的工作订阅" });
  const original = domain.readPublicSubscription(first.token!)!;
  const renamed = editor.renameSubscription(userId, first.id, "我的通勤订阅");
  assert.equal(renamed.name, "我的通勤订阅");
  assert.equal(renamed.version, first.version);
  assert.equal(renamed.updatedAt, first.updatedAt);
  assert.equal(publication.readSubscriptionToken(userId, first.id), first.token);
  assert.equal(domain.readPublicSubscription(first.token!)!.content, original.content);
  assert.throws(() => editor.renameSubscription("other", first.id, "不允许"), /不存在/);
});

test("已生成订阅可再次改分组，旧方案无需项目绑定，保存仍使用原地址", async () => {
  const { userId, projectId, input } = fixture();
  const first = await publication.quickPublish(userId, projectId, input);
  db.prepare("UPDATE generation_profiles SET project_id = NULL WHERE id = ?").run(first.profileId);
  const draft = editor.getSubscriptionEditor(userId, first.id);
  draft.config.proxyGroups.push({ id: randomUUID(), name: "日常备用组", type: "select", proxies: ["DIRECT"], extra: {} });
  const saved = await editor.saveSubscriptionEditor(userId, first.id, { config: draft.config, name: "重新编辑后", revision: draft.revision });
  assert.equal(saved.subscription.id, first.id);
  assert.equal(publication.readSubscriptionToken(userId, first.id), first.token);
  assert.match(domain.readPublicSubscription(first.token!)!.content, /日常备用组/);
  const reopened = editor.getSubscriptionEditor(userId, first.id);
  assert.equal(reopened.config.proxyGroups.length, 2);
  const unchanged = await editor.saveSubscriptionEditor(userId, first.id, { config: reopened.config, name: reopened.subscription.name, revision: reopened.revision });
  assert.equal(unchanged.subscription.version, saved.subscription.version);
});

test("多个链接共用旧方案时编辑仅影响指定订阅，包括后续自动同步", async () => {
  const { userId, projectId, input } = fixture();
  const first = await publication.quickPublish(userId, projectId, input);
  const original = domain.readPublicSubscription(first.token!)!;
  const second = domain.publishSubscription(userId, first.profileId, "另一个链接", "mihomo", original.content, 1);
  const draft = editor.getSubscriptionEditor(userId, first.id);
  draft.config.proxyGroups.push({ id: randomUUID(), name: "仅第一份", type: "select", proxies: ["DIRECT"], extra: {} });
  const saved = await editor.saveSubscriptionEditor(userId, first.id, { config: draft.config, name: "第一份", revision: draft.revision });
  assert.notEqual(saved.subscription.profileId, second.profileId);
  await publication.syncProfile(userId, second.profileId);
  assert.equal(domain.readPublicSubscription(second.token)!.content, original.content);
  assert.match(domain.readPublicSubscription(first.token!)!.content, /仅第一份/);
});

test("编辑的过时版本、非法配置与跨用户节点均被拒绝且不破坏原订阅", async () => {
  const { userId, projectId, input } = fixture();
  const first = await publication.quickPublish(userId, projectId, input);
  const original = domain.readPublicSubscription(first.token!)!;
  const draft = editor.getSubscriptionEditor(userId, first.id);
  editor.renameSubscription(userId, first.id, "另一个窗口改名");
  await assert.rejects(editor.saveSubscriptionEditor(userId, first.id, { config: draft.config, name: "过时修改", revision: draft.revision }), /已经变化/);
  const latest = editor.getSubscriptionEditor(userId, first.id);
  await assert.rejects(editor.saveSubscriptionEditor(userId, first.id, { config: { ...latest.config, proxies: [] }, name: "无节点", revision: latest.revision }), /没有可用节点/);
  const other = fixture();
  const injected = { ...latest.config, proxies: [{ ...other.node, name: latest.config.proxies[0].name }] };
  await assert.rejects(editor.saveSubscriptionEditor(userId, first.id, { config: injected, name: "跨用户", revision: latest.revision }), /无权/);
  assert.equal(domain.readPublicSubscription(first.token!)!.content, original.content);
  assert.equal(domain.readPublicSubscription(first.token!)!.version, original.version);
  assert.throws(() => editor.getSubscriptionEditor(other.userId, first.id), /不存在/);
});

test("编辑隔离更换方案后，正在运行的旧方案同步不能覆盖这份订阅", async () => {
  const { userId, projectId, input, node } = fixture();
  const first = await publication.quickPublish(userId, projectId, input);
  const original = domain.readPublicSubscription(first.token!)!;
  const profile = domain.getProfile(userId, first.profileId)!;
  const isolated = domain.createProfile(userId, { name: "独立编辑方案", targetFormat: "mihomo", config: profile.config, nodeIds: profile.nodeIds, sourceIds: profile.sourceIds })!;
  domain.updateManagedNode(userId, node.id, { ...node, port: 8443 });
  const binary = path.join(directory, "slow-sync-kernel");
  writeFileSync(binary, "#!/bin/sh\nsleep 0.2\nexit 0\n", { mode: 0o700 });
  process.env.MIHOMO_BINARY = binary;
  try {
    const pending = publication.syncProfile(userId, first.profileId);
    const rejected = assert.rejects(pending, /订阅在校验期间发生变化/);
    db.prepare("UPDATE generated_subscriptions SET profile_id = ? WHERE id = ?").run(isolated.id, first.id);
    await rejected;
    assert.equal(domain.readPublicSubscription(first.token!)!.content, original.content);
  } finally { delete process.env.MIHOMO_BINARY; }
});
