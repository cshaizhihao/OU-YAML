import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSubscriptionNodes } from "../server/importer";
import { createEmptyConfig, type ProxyNode } from "../src/shared/types";

const node = (name: string): ProxyNode => ({ id: crypto.randomUUID(), name, type: "vless", server: "example.com", port: 443, uuid: "uuid", extra: {} });

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

