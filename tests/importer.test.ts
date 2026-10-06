import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSubscriptionNodes } from "../server/importer";
import { createEmptyConfig, type ProxyNode } from "../src/shared/types";

const node = (name: string, server = "example.com", uuid = "uuid"): ProxyNode => ({ id: crypto.randomUUID(), name, type: "vless", server, port: 443, uuid, extra: {} });

test("首次订阅导入自动加入默认策略组", () => {
  const output = mergeSubscriptionNodes(createEmptyConfig(), "subscription-1", [node("香港 01"), node("日本 01")]);
  assert.deepEqual(output.proxyGroups[0].proxies, ["香港 01", "日本 01", "DIRECT"]);
  assert.equal(output.proxies.every((item) => item.source?.id === "subscription-1"), true);
});

test("订阅刷新同步替换策略组内的旧节点引用", () => {
  const imported = mergeSubscriptionNodes(createEmptyConfig(), "subscription-1", [node("旧节点")]);
  const refreshed = mergeSubscriptionNodes(imported, "subscription-1", [node("新节点")]);
  assert.deepEqual(refreshed.proxyGroups[0].proxies, ["新节点", "DIRECT"]);
  assert.equal(refreshed.proxies.some((item) => item.name === "旧节点"), false);
});

test("订阅刷新保留节点和策略组的手动顺序，新节点追加", () => {
  const initial = createEmptyConfig();
  initial.proxies = [
    node("手动节点", "manual.example.com", "manual"),
    { ...node("旧 A", "a.example.com", "a"), source: { kind: "subscription", id: "subscription-1" } },
    { ...node("旧 B", "b.example.com", "b"), source: { kind: "subscription", id: "subscription-1" } },
  ];
  initial.proxyGroups = [{ ...initial.proxyGroups[0], proxies: ["旧 B", "DIRECT", "旧 A"] }];
  const refreshed = mergeSubscriptionNodes(initial, "subscription-1", [
    node("更新 A", "a.example.com", "a"),
    node("更新 B", "b.example.com", "b"),
    node("新 C", "c.example.com", "c"),
  ]);
  assert.deepEqual(refreshed.proxies.map((item) => item.name), ["手动节点", "更新 A", "更新 B", "新 C"]);
  assert.deepEqual(refreshed.proxyGroups[0].proxies, ["更新 B", "DIRECT", "更新 A", "新 C"]);
});
