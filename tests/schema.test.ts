import assert from "node:assert/strict";
import { test } from "node:test";
import { readMihomoConfig } from "../src/shared/schema";
import { createEmptyConfig } from "../src/shared/types";

test("Mihomo 配置 schema 拒绝非法端口和版本", () => {
  const config = createEmptyConfig();
  assert.equal(readMihomoConfig(config).success, true);
  assert.equal(readMihomoConfig({ ...config, version: 2 }).success, false);
  assert.equal(readMihomoConfig({ ...config, proxies: [{ ...config.proxies[0], id: "node", name: "节点", type: "vless", server: "example.com", port: 70000 }] }).success, false);
});
