import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import YAML from "yaml";
import { createEmptyConfig, type MihomoConfig, type ProxyNode, type TargetFormat } from "../src/shared/types";
import { addCountryFlag } from "../server/nodeProbe";
import { parseShareLink, serializeShareLink } from "../src/shared/links";
import { previewExport } from "../src/shared/exportConfig";

const directory = mkdtempSync(path.join(os.tmpdir(), "ou-country-names-"));
process.env.DATA_DIR = directory;
const { db } = await import("../server/db");
const domain = await import("../server/domainService");
const { syncProfile } = await import("../server/publicationService");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

function fixture(name = "🇭🇰 入口线路", alias = "🇺🇸 · 我的专属 · 线路") {
  const userId = randomUUID();
  const projectId = randomUUID();
  const stamp = new Date().toISOString();
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(userId, userId, "hash", stamp);
  const source = domain.createNodeSource(userId, { name: "来源", kind: "remote-url", url: "https://example.com/nodes", format: "links" });
  const node = domain.createManagedNode(userId, { name, type: "ss", server: "1.1.1.1", port: 443, cipher: "aes-128-gcm", password: "secret", extra: {}, sourceId: source.id, tags: ["自定义标签"], note: "自定义备注" });
  const config: MihomoConfig = {
    ...createEmptyConfig(),
    proxies: [{ ...node, name: alias, port: 8443 }],
    proxyGroups: [{ id: randomUUID(), name: "线路选择", type: "select", proxies: [alias], extra: {} }],
    rules: [{ id: randomUUID(), type: "MATCH", value: "", target: "线路选择", options: [], enabled: true }],
  };
  db.prepare("INSERT INTO projects (id,user_id,name,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(projectId, userId, "别名项目", JSON.stringify(config), stamp, stamp);
  domain.syncProjectNodes(userId, projectId, config.proxies);
  const project = () => domain.hydrateProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Record<string, unknown>);
  return { userId, projectId, node, config, source, project };
}

test("国旗保存别名正文、组和规则引用，重新读取数据库与来源更新后仍保留", () => {
  const { userId, projectId, node, source, project } = fixture();
  const updated = domain.updateManagedNode(userId, node.id, { ...node, name: addCountryFlag(node.name, "🇯🇵") })!;
  const alias = "🇯🇵 我的专属 · 线路";
  assert.equal(project().config.proxies[0].name, alias);
  assert.equal(project().config.proxies[0].port, 8443);
  assert.deepEqual(project().config.proxyGroups[0].proxies, [alias]);
  assert.equal(project().config.rules[0].target, "线路选择");
  assert.deepEqual(updated.tags, node.tags);
  assert.equal(updated.note, node.note);
  assert.equal(parseShareLink(serializeShareLink(updated)!).name, "🇯🇵 入口线路");

  const reader = new Database(db.name, { readonly: true });
  try {
    const stored = reader.prepare("SELECT name, config_json, name_override FROM managed_nodes WHERE id = ?").get(node.id) as { name: string; config_json: string; name_override: number };
    assert.equal(stored.name, updated.name);
    assert.equal(JSON.parse(stored.config_json).name, updated.name);
    assert.equal(stored.name_override, 1);
    assert.deepEqual(reader.prepare("SELECT alias FROM project_nodes WHERE project_id = ?").get(projectId), { alias });
  } finally { reader.close(); }

  const changes = db.prepare("SELECT total_changes() AS count").get();
  domain.updateManagedNode(userId, node.id, updated);
  assert.deepEqual(db.prepare("SELECT total_changes() AS count").get(), changes);
  domain.replaceManagedNodesForSource(userId, source.id, [{ ...node, id: randomUUID(), name: "上游新名字" }]);
  assert.equal(domain.getManagedNode(userId, node.id)?.name, updated.name);
  assert.equal(project().config.proxies[0].name, alias);
    assert.equal(project().config.rules[0].target, "线路选择");
});

test("生成方案改名不会自行发布，显式同步在原链接输出真正的 YAML/JSON 名称和引用", async () => {
  const { userId, node, config } = fixture();
  const alias = "🇸🇬 我的专属 · 线路";
  const publications = (["mihomo", "sing-box"] as TargetFormat[]).map((format) => {
    const profile = domain.createProfile(userId, { name: format, targetFormat: format, config, nodeIds: [node.id] })!;
    const content = previewExport(config, format).content;
    const subscription = domain.publishSubscription(userId, profile.id, format, format, content, 1);
    return { profile, subscription, before: domain.readPublicSubscription(subscription.token!)! };
  });
  domain.updateManagedNode(userId, node.id, { ...node, name: addCountryFlag(node.name, "🇸🇬") });
  for (const { profile, subscription, before } of publications) {
    const saved = domain.getProfile(userId, profile.id)!;
    assert.equal(saved.config.proxies[0].name, alias);
    assert.equal(saved.config.rules[0].target, "线路选择");
    assert.deepEqual(domain.readPublicSubscription(subscription.token!), before);
    await syncProfile(userId, profile.id);
    const published = domain.readPublicSubscription(subscription.token!)!;
    assert.equal(published.version, before.version + 1);
    if (profile.targetFormat === "mihomo") {
      const parsed = YAML.parse(published.content);
      assert.equal(parsed.proxies[0].name, alias);
      assert.deepEqual(parsed["proxy-groups"][0].proxies, [alias]);
      assert.deepEqual(parsed.rules, ["MATCH,线路选择"]);
    } else {
      const parsed = JSON.parse(published.content);
      assert.equal(parsed.outbounds[0].tag, alias);
      assert.deepEqual(parsed.outbounds.find((outbound: { tag: string }) => outbound.tag === "线路选择").outbounds, [alias]);
      assert.equal(parsed.route.final, "线路选择");
    }
    await syncProfile(userId, profile.id);
    assert.equal(domain.readPublicSubscription(subscription.token!)!.version, published.version);
  }
});

test("相同国旗可修复旧的未同步别名，之后重复操作不写数据库", () => {
  const { userId, node, config, project } = fixture("🇯🇵 入口线路", "我的专属线路");
  const profile = domain.createProfile(userId, { name: "旧方案", targetFormat: "mihomo", config, nodeIds: [node.id] })!;
  domain.updateManagedNode(userId, node.id, node);
  assert.equal(project().config.proxies[0].name, "🇯🇵 我的专属线路");
  assert.equal(domain.getProfile(userId, profile.id)!.config.rules[0].target, "线路选择");
  const changes = db.prepare("SELECT total_changes() AS count").get();
  domain.updateManagedNode(userId, node.id, node);
  assert.deepEqual(db.prepare("SELECT total_changes() AS count").get(), changes);
});

test("方案的节点或组名冲突会回滚先前的项目和节点写入", () => {
  for (const kind of ["node", "group"] as const) {
    const { userId, node, config, project } = fixture();
    const alias = "🇯🇵 我的专属 · 线路";
    const conflict: ProxyNode = { ...node, id: randomUUID(), name: alias };
    const profileConfig = kind === "node"
      ? { ...config, proxies: [...config.proxies, conflict] }
      : { ...config, proxyGroups: [...config.proxyGroups, { id: randomUUID(), name: alias, type: "select" as const, proxies: ["DIRECT"], extra: {} }] };
    const profile = domain.createProfile(userId, { name: "冲突方案", targetFormat: "mihomo", config: profileConfig, nodeIds: [node.id] })!;
    const before = project();
    assert.throws(() => domain.updateManagedNode(userId, node.id, { ...node, name: addCountryFlag(node.name, "🇯🇵") }), /冲突方案.*冲突/);
    assert.deepEqual(domain.getManagedNode(userId, node.id), node);
    assert.deepEqual(project(), before);
    assert.deepEqual(domain.getProfile(userId, profile.id), profile);
  }
});

test("节点库目标重名和自定义别名超长均拒绝，不静默截断或重命名", () => {
  const first = fixture();
  domain.createManagedNode(first.userId, { ...first.node, id: randomUUID(), name: "🇯🇵 入口线路" });
  assert.throws(() => domain.updateManagedNode(first.userId, first.node.id, { ...first.node, name: "🇯🇵 入口线路" }), /节点库.*冲突/);
  assert.deepEqual(domain.getManagedNode(first.userId, first.node.id), first.node);
  const second = fixture("入口线路", "长".repeat(200));
  assert.throws(() => domain.updateManagedNode(second.userId, second.node.id, { ...second.node, name: "🇯🇵 入口线路" }), /超过 200/);
  assert.equal(second.project().config.proxies[0].name, "长".repeat(200));
  assert.deepEqual(domain.getManagedNode(second.userId, second.node.id), second.node);
});

test("普通改名保留自定义别名正文与国旗", () => {
  const { userId, node, config, project } = fixture();
  const profile = domain.createProfile(userId, { name: "普通方案", targetFormat: "mihomo", config, nodeIds: [node.id] })!;
  domain.updateManagedNode(userId, node.id, { ...node, name: "完全不同的新名称" });
  assert.equal(project().config.proxies[0].name, config.proxies[0].name);
  assert.equal(domain.getProfile(userId, profile.id)!.config.proxies[0].name, config.proxies[0].name);
});
